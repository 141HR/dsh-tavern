		// One "预设" tab: the preset, system prompt set and long-term preference that
		// shape how stories are told, each picked here and shared as one file.
		function TavernPresetHubTab(props) {
			const h = React.createElement;
			const askConfirm = useTavernConfirm(props.scope && props.scope.sessionId);
			const sessionId = props.scope && props.scope.sessionId || "";
			const requestedSection = props.tab && props.tab.meta && typeof props.tab.meta.section === "string" ? props.tab.meta.section : "";
			const [section, setSection] = React.useState(requestedSection);
			const [summary, setSummary] = React.useState(null);
			const [include, setInclude] = React.useState({ preset: true, systemPrompts: true, userProfile: true });
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [notice, setNotice] = React.useState("");
			const [generation, setGeneration] = React.useState(0);
			const importInput = React.useRef(null);
			React.useEffect(function () { if (requestedSection) setSection(requestedSection); }, [requestedSection, props.tab && props.tab.meta]);
			async function load() {
				try {
					const all = await Promise.all([rpc("listPresets", {}, sessionId), rpc("getSystemPrompts"), rpc("getUserPreferenceProfile", { sessionId: sessionId }, sessionId)]);
					const presets = all[0] || {}; const prompts = all[1] && all[1].systemPrompts || {}; const profile = all[2] && all[2].userProfile || {};
					setSummary({
						presets: (presets.presets || []).filter(function (item) { return item.valid === true && item.recognized === true; }), activePresetPath: presets.activePresetPath || "",
						promptSets: prompts.promptSets || { activeId: "", sets: [] },
						profiles: (profile.profiles || []).filter(function (item) { return item.hasConfirmed; }), defaultProfileId: profile.defaultProfileId || ""
					});
					setError("");
				} catch (err) { setError(String(err && err.message || err)); }
			}
			React.useEffect(function () {
				void load();
				function onData(event) { if (tavernDataChangeAffects(event, ["presets", "user-profile", "system-prompts"], "preset-hub")) void load(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, [sessionId, section]);
			async function run(task, kinds) {
				setBusy(true); setError(""); setNotice("");
				try { const message = await task(); if (kinds) notifyTavernDataChanged(kinds, "preset-hub"); await load(); if (message) setNotice(message); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function selectPreset(path) { return run(async function () { await rpc("selectPreset", { path: path }, sessionId); return "新游戏默认预设已更新。"; }, ["presets"]); }
			function selectPromptSet(id) { return run(async function () { await rpc("manageSystemPromptSet", { action: "select", id: id }); return "已切换系统提示词方案，将从下一次请求开始生效。"; }, ["system-prompts"]); }
			function selectProfile(id) { return run(async function () { await rpc("manageUserPreferenceProfile", { action: "default", profileId: id }, sessionId); return "新游戏默认长期偏好已更新。"; }, ["user-profile"]); }
			const available = summary ? { preset: Boolean(summary.activePresetPath), systemPrompts: true, userProfile: Boolean(summary.defaultProfileId) } : {};
			const chosen = ["preset", "systemPrompts", "userProfile"].filter(function (part) { return include[part] && available[part]; });
			function exportBundle() {
				return run(async function () {
					const parts = {}; chosen.forEach(function (part) { parts[part] = true; });
					const result = await rpc("exportSettingsBundle", { include: parts });
					const blob = new Blob([result.text], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
					link.href = url; link.download = result.name || "dsh-tavern-preset.dshpreset.json"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
					return "已导出 " + chosen.length + " 项。";
				});
			}
			async function importBundle(file) {
				if (!file) return;
				let payload, parts = [];
				try {
					payload = await parseTextResourceFile(file);
					const value = JSON.parse(payload.text);
					if (value && value.spec === "dsh-tavern.bundle") {
						if (value.preset) parts.push("预设");
						if (value.systemPrompts) parts.push("系统提示词方案");
						if (value.userProfile) parts.push("长期偏好");
					} else if (value && value.spec === "dsh-tavern.system-prompts") parts.push("系统提示词方案");
					else if (value && Array.isArray(value.prompts)) parts.push("酒馆预设");
				} catch (err) { setError("无法读取文件：" + String(err && err.message || err)); return; }
				if (!parts.length) { setError("无法识别的文件：既不是 DSH Tavern 预设包，也不是酒馆预设或系统提示词文件"); return; }
				if (!await askConfirm("将导入：" + parts.join("、") + "。每一项都作为新方案加入，并设为使用中；已有内容不会被覆盖。继续？")) return;
				return run(async function () {
					const result = await rpc("importSettingsBundle", { payload: payload });
					const imported = result.imported || {}; const done = [];
					if (imported.preset) done.push("预设“" + imported.preset.title + "”" + (imported.preset.selected ? "" : "（不是可运行的酒馆预设，未设为默认）"));
					if (imported.systemPrompts) done.push("系统提示词方案“" + imported.systemPrompts.name + "”");
					if (imported.userProfile) done.push("长期偏好“" + imported.userProfile.name + "”");
					setGeneration(function (value) { return value + 1; });
					return "已导入" + done.join("、") + "。";
				}, ["presets", "user-profile", "system-prompts"]);
			}
			if (section) {
				const detail = section === "preset" ? h(presetLibraryFeature.Tab, { scope: props.scope, visible: props.visible, appendMention: props.appendMention })
					: section === "systemPrompts" ? h(SystemPromptSidebarTab, null)
					: h(UserPreferenceProfileTab, { scope: props.scope });
				return h("div", { className: "dsh-tavern-preset-hub-detail" },
					h("div", { className: "dsh-tavern-preset-hub-back" }, h("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { setSection(""); } }, "← 返回预设")),
					h(React.Fragment, { key: generation }, detail));
			}
			function row(part, title, hint, select) {
				return h("section", { className: "dsh-tavern-preset-hub-row", "aria-label": title },
					h("label", { className: "dsh-tavern-preset-hub-include", title: available[part] ? "导出时包含此项" : "未选择，导出时跳过" }, h("input", { type: "checkbox", checked: include[part] && available[part] === true, disabled: busy || !available[part], onChange: function (event) { const checked = event.target.checked; setInclude(function (current) { return Object.assign({}, current, { [part]: checked }); }); } })),
					h("div", { className: "dsh-tavern-preset-hub-main" }, h("b", null, title), h("small", null, hint), select),
					h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { setSection(part); } }, "详情 ›"));
			}
			const s = summary;
			return h("div", { className: "dsh-tavern-presets dsh-tavern-preset-hub" },
				h("div", { className: "dsh-tavern-status-head" },
					h("div", { className: "dsh-tavern-status-title" }, "预设"),
					h("div", { className: "dsh-tavern-question-sub" }, "决定故事怎么讲：预设、系统提示词、长期偏好。勾选的项目会一起导出成一个文件。"),
					h("div", { className: "dsh-tavern-system-prompt-top-actions" },
						h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入"),
						h("button", { className: "dsh-tavern-btn primary", disabled: busy || !chosen.length, onClick: function () { void exportBundle(); } }, "导出勾选项"),
						h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; void importBundle(file); event.target.value = ""; } }))),
				error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, error) : null,
				notice ? h("div", { className: "dsh-tavern-system-prompt-status", role: "status" }, notice) : null,
				s === null ? h("div", { className: "dsh-tavern-status-empty" }, "正在读取…") : h("div", { className: "dsh-tavern-preset-hub-list" },
					row("preset", "预设", "新游戏默认使用；每局可在本局设置中单独切换",
						h("select", { className: "dsh-tavern-settings-select", "aria-label": "新游戏默认预设", value: s.activePresetPath, disabled: busy, onChange: function (event) { void selectPreset(event.target.value); } },
							h("option", { value: "" }, "不使用外部预设（默认）"), s.presets.map(function (item) { return h("option", { key: item.path, value: item.path }, item.title); }))),
					row("systemPrompts", "系统提示词", "对所有游戏生效",
						h("select", { className: "dsh-tavern-settings-select", "aria-label": "系统提示词方案", value: s.promptSets.activeId, disabled: busy, onChange: function (event) { void selectPromptSet(event.target.value); } },
							s.promptSets.sets.map(function (item) { return h("option", { key: item.id, value: item.id }, item.name); }))),
					row("userProfile", "长期偏好", "新游戏默认使用；每局可在本局设置中单独切换",
						h("select", { className: "dsh-tavern-settings-select", "aria-label": "新游戏默认长期偏好", value: s.defaultProfileId, disabled: busy, onChange: function (event) { void selectProfile(event.target.value); } },
							h("option", { value: "" }, "不启用"), s.profiles.map(function (item) { return h("option", { key: item.id, value: item.id }, item.name); })))));
		}
