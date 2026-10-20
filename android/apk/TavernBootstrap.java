package com.deepseekharness.app.core;

import android.content.Context;
import com.deepseekharness.app.runtime.ProotBootstrap;
import com.deepseekharness.app.util.Compat;
import com.deepseekharness.app.util.InstallProcess;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** 在现有启动锁内安装；只有完整安装成功后才留下完成标记。 */
public final class TavernBootstrap {
    private TavernBootstrap() { }

    /** 默认走 npmmirror；依赖下载失败时用官方源再试一次，避免 APK 内无法改环境变量。 */
    private static final String FALLBACK_REGISTRY = "https://registry.npmjs.org";
    /** APK 内置离线包（源码 + pnpm store + pnpm 运行时），首装不必联网。 */
    private static final String OFFLINE_ASSET = "tavern-offline.bin";
    /** 容器内落地名；内容仍是 gzip 压缩的 tar（aapt 会把 .tar.gz 静默解成 .tar，故用 .bin）。 */
    private static final String OFFLINE_FILE = "tavern-offline.tar";

    public static void ensure(Context context, ProotBootstrap boot,
                              BooleanSupplier cancelled, Consumer<String> status) throws Exception {
        File root = boot.getRootfsDir();
        File marker = new File(root, "root/.dsh/tavern-apk-installed");
        File profile = new File(root, "root/.dsh/profiles/tavern/package.json");
        File source = new File(root, "root/.dsh/apps/dsh-tavern/bin/dsh-tavern.mjs");
        if (marker.isFile() && profile.isFile() && source.isFile()) return;
        status.accept("首次安装：正在解包内置依赖（无需联网），请保持应用打开……");
        File script = new File(root, "root/tavern-apk-setup.sh");
        try (InputStream in = context.getAssets().open("tavern-apk-setup.sh");
             FileOutputStream out = new FileOutputStream(script)) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
        }
        copyOfflineBundle(context, root, cancelled, status);
        int exit = run(boot, "", false, cancelled, status);
        if (exit != 0) {
            status.accept("内置依赖安装未完成，正在改用官方 npm 源重试……");
            exit = run(boot, " DSH_TAVERN_NPM_REGISTRY=" + FALLBACK_REGISTRY, true, cancelled, status);
        }
        if (exit != 0) throw new java.io.IOException("酒馆安装失败，可检查网络后点击启动重试；日志：.dsh/logs/tavern-install.log");
        if (!profile.isFile() || !source.isFile()) throw new java.io.IOException("酒馆安装结果不完整，请重试");
        Compat.write(marker, "1\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    /** 把内置离线包流式拷进容器；失败不阻断，setup.sh 会自动回退成联网安装。 */
    private static void copyOfflineBundle(Context context, File root,
                                          BooleanSupplier cancelled, Consumer<String> status) {
        File target = new File(root, "root/" + OFFLINE_FILE);
        // 先写 .part 再改名：target 存在即完整，重试时不必重复拷几百 MB。
        File partial = new File(root, "root/" + OFFLINE_FILE + ".part");
        try {
            boolean present = false;
            for (String name : context.getAssets().list("")) if (OFFLINE_ASSET.equals(name)) { present = true; break; }
            if (!present) return;
            if (target.isFile() && target.length() > 0) return;
            long declaredSize = -1;
            try (InputStream probe = context.getAssets().open(OFFLINE_ASSET)) { declaredSize = probe.available(); }
            catch (Exception ignored) { }
            status.accept("首次安装：正在释放内置依赖包，约需 1-2 分钟……");
            try (InputStream in = context.getAssets().open(OFFLINE_ASSET);
                 FileOutputStream out = new FileOutputStream(partial)) {
                byte[] buffer = new byte[1 << 20];
                long copied = 0;
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (cancelled.getAsBoolean()) throw new java.io.IOException("安装已取消");
                    out.write(buffer, 0, count);
                    copied += count;
                    if (declaredSize > 0 && copied % (32L << 20) < count) {
                        status.accept("首次安装：释放内置依赖包 " + (copied * 100 / declaredSize) + "%……");
                    }
                }
            }
            if (!partial.renameTo(target)) throw new java.io.IOException("离线包落盘失败");
        } catch (Exception error) {
            status.accept("内置依赖包不可用，将改用联网安装……");
            // 半成品会让 setup.sh 解压失败；删掉它保证回退路径干净。
            if (target.isFile() && !target.delete()) { /* 忽略：setup.sh 会在解压失败时回退 */ }
            if (partial.isFile() && !partial.delete()) { /* 同上 */ }
        }
    }

    private static int run(ProotBootstrap boot, String extraEnvironment, boolean append,
                           BooleanSupplier cancelled, Consumer<String> status) throws Exception {
        // pnpm 默认单请求 60 秒超时，慢速移动网络下载大包会批量报 error (23)；
        // 提到 10 分钟，且 install.sh 的 pnpm 包装也会显式传同一个上限。
        String command = "set -o pipefail; export DSH_TAVERN_ANDROID_STANDALONE=1"
                + " pnpm_config_fetch_timeout=600000" + extraEnvironment
                + "; mkdir -p /root/.dsh/logs; "
                + "bash /root/tavern-apk-setup.sh 2>&1 | tee "
                + (append ? "-a " : "") + "/root/.dsh/logs/tavern-install.log";
        return InstallProcess.read(boot.execRootfsForInstall(command), 3600000L,
                true, cancelled, status, Compat::destroy);
    }
}
