		// 精修对比: the latest 精修 of this game, original and polished text side by side, each change
		// numbered and coloured with its reason. Shown while that turn still holds the polished text.
		function tavernPolishParagraphs(segments, side) {
			const h = React.createElement;
			const paragraphs = [[]];
			function push(text, wrap) {
				String(text).split(/\n+/).forEach(function (piece, index) {
					if (index > 0) paragraphs.push([]);
					if (piece) paragraphs[paragraphs.length - 1].push(wrap ? wrap(piece) : piece);
				});
			}
			segments.forEach(function (segment, at) {
				if (segment.kind === "same") { push(segment.text); return; }
				const cls = "dsh-polish-mark";
				if (side === "before") push(segment.find, function (piece) { return h("del", { key: at + piece, className: cls }, piece); });
				else if (segment.replace) push(segment.replace, function (piece) { return h("ins", { key: at + piece, className: cls }, piece); });
				else paragraphs[paragraphs.length - 1].push(h("span", { key: at + "cut", className: "dsh-polish-cut" }, "（删去）"));
				paragraphs[paragraphs.length - 1].push(h("sup", { key: at + "n", className: "dsh-polish-badge dsh-polish-n" + (segment.n % 8) }, segment.n));
			});
			return paragraphs.filter(function (children) { return children.length; }).map(function (children, index) { return h("p", { key: index }, children); });
		}

		function PolishComparisonView(props) {
			const h = React.createElement;
			const sessionId = props.polishSessionId;
			const [state, setState] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const revision = React.useRef(0);
			const load = React.useCallback(async function () {
				const requested = ++revision.current;
				setBusy(true);
				try {
					const result = await rpc("polishComparison", {}, sessionId);
					if (requested === revision.current) setState({ sessionId: sessionId, comparison: result.comparison || null, error: "" });
				} catch (error) {
					if (requested === revision.current) setState({ sessionId: sessionId, comparison: null, error: String(error && error.message || error) });
				} finally { if (requested === revision.current) setBusy(false); }
			}, [sessionId]);
			React.useEffect(function () {
				setState(null);
				void load();
				function changed(event) { if (!event.detail || event.detail.sessionId === sessionId) void load(); }
				window.addEventListener("dsh-tavern-polished", changed);
				return function () { window.removeEventListener("dsh-tavern-polished", changed); };
			}, [sessionId, load]);
			const current = state && state.sessionId === sessionId ? state : null;
			const comparison = current && current.comparison;
			const edits = comparison ? comparison.segments.filter(function (segment) { return segment.kind === "edit"; }).sort(function (a, b) { return a.n - b.n; }) : [];
			return h("section", { className: "dsh-tavern-full-context dsh-tavern-polish-compare" },
				h("header", { className: "dsh-context-header" },
					h("div", null, h("h3", null, "精修对比"),
						h("p", null, !current ? "读取中…" : comparison
							? "第 " + comparison.turn + " 轮 · 改了 " + comparison.count + " 处" + (comparison.seconds ? " · 用时 " + comparison.seconds + " 秒" : "") + " · " + new Date(comparison.at).toLocaleString()
							: current.error ? "读取失败" : "最近一次精修")),
					h("button", { disabled: busy, onClick: load }, busy ? "读取中…" : "刷新")),
				current && current.error ? h("p", { role: "status" }, current.error) : null,
				current && !comparison && !current.error ? h("p", { className: "dsh-context-empty" }, "还没有可对比的精修。在最后一轮正文下点「重新生成正文」→「精修」，改完回到这里看前后对比；撤销或再改动那轮正文后，这里就清空。") : null,
				comparison ? h("div", { className: "dsh-polish-cols" },
					h("div", { className: "dsh-polish-col" }, h("h4", null, "原文"), tavernPolishParagraphs(comparison.segments, "before")),
					h("div", { className: "dsh-polish-col" }, h("h4", null, "精修"), tavernPolishParagraphs(comparison.segments, "after"))) : null,
				edits.length ? h("ol", { className: "dsh-polish-reasons" }, edits.map(function (segment) {
					return h("li", { key: segment.n }, h("span", { className: "dsh-polish-badge dsh-polish-n" + (segment.n % 8) }, segment.n), segment.reason || "修改");
				})) : null);
		}
