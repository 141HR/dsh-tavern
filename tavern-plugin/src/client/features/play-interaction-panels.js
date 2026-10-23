// Presentation and composer draft lifetime; async transitions belong to interactions.
function createPlayInteractionPanels({ interactions, useCandidatePanel, useCandidateGuidePanel, useRegenPanel }) {
    const setCandidatePanel = interactions.candidates.set;
    const setRegenPanel = interactions.regeneration.set;
		function CandidateQuestion(props) {
            // 宿主输入器可由 textarea 升级为 contenteditable，两种入口共享聚焦与收起逻辑。
            const inputSelector = "[data-composer-card] :is(textarea, [contenteditable='true'])";
            const dismissMode = useCandidatePreferences();
			const panel = useCandidatePanel();
            const draft = props.useInput(snapshot => snapshot.draft);
            const draftRef = React.useRef(draft);
            draftRef.current = draft;
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const [added, setAdded] = React.useState([]);
            const expanded = Boolean(panel && panel.expanded);
            function setExpanded(value) {
                if (panel) setCandidatePanel(Object.assign({}, panel, { expanded: value }));
            }
            React.useEffect(() => { if (running && panel?.expanded) setExpanded(false); }, [running, panel]);
			React.useEffect(function () {
				if (typeof document === "undefined" || !panel?.expanded) return;
				function onComposerFocus(event) {
					// 手机开始手动输入就收起候选，给键盘上方的正文留出空间；面板编辑器不受影响。
					if (window.matchMedia(TAVERN_MOBILE_QUERY + ", (pointer: coarse)").matches && event.target?.matches(inputSelector)) setExpanded(false);
				}
				document.addEventListener("focusin", onComposerFocus);
				return function () { document.removeEventListener("focusin", onComposerFocus); };
			}, [panel]);
			React.useEffect(function () {
				setAdded([]);
			}, [panel?.choices]);

			if (panel && panel.sessionId === props.sessionId && panel.phase === "error") {
				return React.createElement("div", { className: "dsh-tavern-choice-error dsh-tavern-candidate-error-banner" },
					"候选项生成失败：" + (panel.error || "未知错误") + "。请点上方“生成候选项”重试。"
				);
			}
			if (!isPlayMode(sessionMode) || !panel || panel.sessionId !== props.sessionId || panel.messageId !== latestMessageId || running) {
				return null;
			}
			const h = React.createElement;
			const count = (panel.choices || []).length;
			const isScript = sessionMode === "script";
			const heading = "接下来的行动";
			const summary = panel.phase === "loading" ? "正在生成…" : (panel.error ? "生成失败" : (isScript ? "跟随剧本" : count + " 个"));
			return h("div", { className: "dsh-tavern-question dsh-tavern-candidate-question" + (expanded ? "" : " collapsed") },
				h("div", { className: "dsh-tavern-question-head", role: "button", tabIndex: 0, "aria-expanded": expanded ? "true" : "false", onClick: function () { setExpanded(!expanded); }, onKeyDown: function (event) { if (event.target === event.currentTarget && !event.isComposing && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setExpanded(!expanded); } } }, h("span", null, heading), h("span", { className: "dsh-tavern-question-sub" }, summary), h("button", { type: "button", className: "dsh-tavern-question-close", title: expanded ? "收起行动列表" : "展开行动列表", "aria-label": expanded ? "收起行动列表" : "展开行动列表", onClick: function (event) { event.stopPropagation(); setExpanded(!expanded); } }, expanded ? "⌃" : "⌄")),
				expanded && panel.phase === "loading" ? h("div", { className: "dsh-tavern-question-sub" }, "正在生成候选项…") : null,
				expanded && panel.error ? h("div", { className: "dsh-tavern-choice-error" }, "候选项生成失败，请点回复下方的“生成候选项”重试") : null,
				expanded ? h("div", { className: "dsh-tavern-question-body" }, (panel.choices || []).map(function (choice, index) {
					const item = choice !== null && typeof choice === "object" ? choice : { type: "action", text: String(choice) };
					// 点选项即追加到输入框，再点一次取消并从输入框移除；发送前仍可修改。
					const isAdded = added.includes(index);
					return h("button", { key: index, className: "dsh-tavern-question-option" + (isAdded ? " selected" : ""), "aria-pressed": isAdded, title: isAdded ? "从输入框移除" : "追加到输入框", onClick: function () {
						const marked = item.type === "scene" ? "【场景变化】" + item.text : item.text;
						const current = String(draftRef.current || "");
						let next;
						if (isAdded) {
							// 只移除原样追加的那一行；用户改过的文字保留不动。
							const lines = current.split("\n");
							const at = lines.lastIndexOf(marked);
							if (at >= 0) lines.splice(at, 1);
							next = lines.join("\n").replace(/^\n+|\n+$/g, "");
						} else next = current + (current && !current.endsWith("\n") ? "\n" : "") + marked;
						draftRef.current = next;
						props.inputActions.setDraft(next);
						if (!isAdded && dismissMode !== "after-send") setCandidatePanel(null);
						else setAdded(list => isAdded ? list.filter(value => value !== index) : list.concat(index));
					} },
						h("span", { className: "dsh-tavern-question-text" },
							item.type === "scene" ? h("span", { className: "dsh-tavern-question-tag dsh-tavern-question-tag-scene" }, "场景变化") : null,
							h("span", null, item.text)
						)
					);
				})) : null
			);
		}

		function CandidateGuidePanel(props) {
			const panel = useCandidateGuidePanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const [guidance, setGuidance] = React.useState("");
            React.useEffect(() => setGuidance(""), [props.sessionId, panel?.messageId]);
			const h = React.createElement;
			if (!isPlayMode(sessionMode) || running || !panel || panel.sessionId !== props.sessionId || panel.messageId !== latestMessageId) {
				return null;
			}
			const isScript = sessionMode === "script";
            function generateGuided() { return interactions.regenerateCandidates(panel, guidance); }
            function cancel() { interactions.cancelGuide(panel); }
			return h(RegenGuideForm, {
				title: "重新生成候选项",
				hint: isScript ? "跟随剧本，只重新生成一个推荐候选" : "行动候选与场景候选通用",
				loading: panel.phase === "loading" ? "正在重新生成候选项…" : "",
				error: panel.error || reviewNote,
				value: guidance,
				onChange: setGuidance,
				placeholder: "对候选的要求（可选）",
				examples: isScript ? ["侧重角色行动", "直接开新场景"] : ["多点暧昧动作", "场景换到白天户外", "新场景换一批人物"],
				submitLabel: "重新生成",
				onSubmit: generateGuided,
				onCancel: cancel
			});
		}

		// Shared guidance form of the candidate and body regeneration panels.
		function RegenGuideForm(props) {
			const h = React.createElement;
			function addExample(text) {
				const current = props.value.trim();
				props.onChange(current ? current + "；" + text : text);
			}
			function onKeyDown(e) {
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); props.onSubmit(); }
				else if (e.key === "Escape") { e.preventDefault(); props.onCancel(); }
			}
			const body = props.loading
				? h("div", { className: "dsh-tavern-regen-loading" }, props.loading)
				: h(React.Fragment, null,
					props.error ? h("div", { className: "dsh-tavern-choice-error" }, props.error) : null,
					h("textarea", {
						className: "dsh-tavern-regen-input",
						rows: 2,
						autoFocus: true,
						value: props.value,
						placeholder: props.placeholder,
						onChange: function (e) { props.onChange(e.target.value); },
						onKeyDown: onKeyDown
					}),
					props.extra || null,
					h("div", { className: "dsh-tavern-regen-foot" },
						h("div", { className: "dsh-tavern-regen-examples" }, props.examples.map(function (text) {
							return h("button", { key: text, type: "button", className: "dsh-tavern-regen-example", onClick: function () { addExample(text); } }, text);
						})),
						h("button", { type: "button", className: "dsh-tavern-regen-cancel", onClick: props.onCancel }, "取消"),
						props.secondary ? h("button", { type: "button", className: "dsh-tavern-regen-cancel", title: props.secondary.title, disabled: props.secondary.disabled, onClick: props.secondary.onClick }, props.secondary.label) : null,
						h("button", { type: "button", className: "dsh-tavern-question-primary dsh-tavern-regen-submit", onClick: props.onSubmit }, props.submitLabel)
					)
				);
			return h("div", { className: "dsh-tavern-question dsh-tavern-regen" },
				h("div", { className: "dsh-tavern-regen-head" },
					h("span", { className: "dsh-tavern-regen-title" }, props.title),
					h("span", { className: "dsh-tavern-question-sub" }, props.hint)
				),
				body
			);
		}

		// The last guidance per game, offered again when the player regenerates once more.
		function RegenPanel(props) {
			const panel = useRegenPanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const [guidance, setGuidance] = React.useState(function () { return interactions.guidance(props.sessionId); });
			const [restyle, setRestyle] = React.useState(false);
			const [styleGuidance, setStyleGuidance] = React.useState("");
			const [reviewing, setReviewing] = React.useState(false);
			const [reviewNote, setReviewNote] = React.useState("");
			const [review, setReview] = React.useState(null);
			const [applying, setApplying] = React.useState(false);
            React.useEffect(() => { setRestyle(false); setStyleGuidance(""); }, [props.sessionId]);
			const styleState = useLiveTavernView(props.sessionId, "regen-style");
			const styleEnabled = styleState.view?.styleReferenceEnabled === true;
			const opened = panel && panel.sessionId === props.sessionId && panel.phase === "input";
			React.useEffect(function () { if (opened) setGuidance(interactions.guidance(props.sessionId)); }, [opened, props.sessionId]);
			React.useEffect(() => { if (!opened) setReview(null); }, [opened]);
			const h = React.createElement;
			if (!isPlayMode(sessionMode) || running || !panel || panel.sessionId !== props.sessionId) return null;
            function generate() {
                return interactions.regenerateBody(panel, guidance, { restyle: styleEnabled && restyle, styleGuidance });
            }
            // 精修: the editor's edits are listed to tick and apply in place; unreadable output falls back to the guidance box.
            async function runReview() {
                setReviewing(true); setReviewNote(""); setReview(null);
                try {
                    const result = await rpc("polishReview", {}, props.sessionId);
                    const edits = result.edits.map(edit => ({ ...edit, checked: edit.status === "ok" }));
                    if (result.guidance) setGuidance(result.guidance);
                    if (edits.length) setReview({ token: result.token, edits });
                    if (!edits.length && !result.guidance) setReviewNote("审稿没有发现需要修改的地方");
                } catch (error) { setReviewNote("审稿失败：" + String(error?.message || error)); }
                finally { setReviewing(false); }
            }
            async function applyEdits() {
                const chosen = review.edits.filter(edit => edit.checked && edit.status === "ok");
                if (!chosen.length) return;
                setApplying(true); setReviewNote("");
                try {
                    const result = await rpc("applyPolishEdits", { token: review.token, edits: chosen.map(edit => ({ find: edit.find, replace: edit.replace })) }, props.sessionId);
                    liveTavernView.setView(props.sessionId, result.view);
                    notifyTavernDataChanged(["sessions"], "play-controls");
                    tavernCoordination.invalidate(props.sessionId);
                    setReview(null);
                    setRegenPanel(null);
                } catch (error) { setReviewNote("应用修改失败：" + String(error?.message || error)); }
                finally { setApplying(false); }
            }
            function toggle(index) {
                setReview(current => ({ ...current, edits: current.edits.map((edit, at) => at === index ? { ...edit, checked: !edit.checked } : edit) }));
            }
            const editList = review ? h("div", { className: "dsh-tavern-polish-edits" },
                h("div", { className: "dsh-tavern-polish-head" }, "修改清单：勾选后直接替换原文，其余文字不动"),
                review.edits.map((edit, index) => h("label", { key: index, className: "dsh-tavern-polish-edit" + (edit.status === "ok" ? "" : " is-missing") },
                    h("input", { type: "checkbox", checked: edit.checked, disabled: edit.status !== "ok", onChange: () => toggle(index) }),
                    h("span", { className: "dsh-tavern-polish-body" },
                        h("span", { className: "dsh-tavern-polish-title" }, (edit.reason || "修改") + (edit.status === "missing" ? "（原文里没找到这段）" : edit.status === "ambiguous" ? "（这段在正文里出现了不止一次）" : edit.status === "overlap" ? "（和上面某条修改重叠）" : "")),
                        h("del", null, edit.find),
                        edit.replace ? h("ins", null, edit.replace) : h("span", { className: "dsh-tavern-polish-reason" }, "（删去）")))),
                h("div", { className: "dsh-tavern-regen-foot" },
                    h("button", { type: "button", className: "dsh-tavern-question-primary", disabled: applying || !review.edits.some(edit => edit.checked && edit.status === "ok"), onClick: applyEdits },
                        applying ? "正在应用…" : "应用所选修改（" + review.edits.filter(edit => edit.checked && edit.status === "ok").length + "）"))) : null;
			return h(RegenGuideForm, {
				title: "重新生成正文",
				hint: "不填意见是重新来一次；填了意见就在当前正文基础上改；精修：审稿列出修改清单，勾选后直接替换原文",
				loading: panel.phase === "loading" ? (panel.restyle ? "正在换文风联想并重新生成…" : panel.rewrite ? "正在按意见改写正文…" : "正在重新生成正文…") : "",
				extra: h(React.Fragment, null, editList, styleEnabled ? h("div", { className: "dsh-tavern-regen-style" },
					h("label", null, h("input", { type: "checkbox", checked: restyle, onChange: event => setRestyle(event.target.checked) }), " 同时换一段文风联想"),
					restyle ? h("input", { className: "dsh-tavern-regen-input", value: styleGuidance, maxLength: 500, placeholder: "换参考的要求（可选），例如：要金庸的打斗描写", onChange: event => setStyleGuidance(event.target.value) }) : null) : null),
				error: panel.error,
				value: guidance,
				onChange: setGuidance,
				placeholder: "指导意见（可选）",
				examples: ["写得更长", "侧重心理描写", "加快节奏"],
				submitLabel: "生成并替换正文",
				secondary: { label: reviewing ? "审稿中…" : "精修", title: "按「正文精修原则」审读当前正文，列出修改清单（一句到整段），勾选后直接替换原文，不重新生成", disabled: reviewing || applying, onClick: runReview },
				onSubmit: generate,
				onCancel: function () { setRegenPanel(null); }
			});
		}
    return Object.freeze({ CandidateQuestion, CandidateGuidePanel, RegenPanel });
}
