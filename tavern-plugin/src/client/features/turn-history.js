		function TavernDockedPanel(props) {
			const ref = React.useRef(null);
			React.useLayoutEffect(function () {
				tavernPanelRegistry.dock(props.id, ref.current);
				return function () { tavernPanelRegistry.restore(props.id); };
			}, [props.id]);
			return React.createElement("div", { ref: ref });
		}
		function TavernPersistentStatusRuntime(props) {
			const entries = React.useSyncExternalStore(tavernPanelRegistry.subscribe, tavernPanelRegistry.inspect);
			const [selected, setSelected] = React.useState("");
			const [refreshes, setRefreshes] = React.useState({});
			const view = props.view;
			// "pinned": only panels pinned from messages (status bar shown in the story body);
			// "status": only the card's status views (that body copy). Default: both.
			const statuses = view && isPlayMode(view.mode) && props.panels !== "pinned" ? (view.tavernStatusViews || []) : [];
			const manual = props.panels === "status" ? [] : entries.filter(function (entry) { return entry.sessionId === props.sessionId && entry.pinned; });
			const newest = manual.reduce(function (latest, entry) { return !latest || entry.activation > latest.activation ? entry : latest; }, null);
			React.useEffect(function () { if (newest) setSelected(newest.id); }, [props.sessionId, newest && newest.activation]);
			const ids = statuses.map(function (panel) { return panel.viewId; }).concat(manual.map(function (entry) { return entry.id; }));
			const active = ids.includes(selected) ? selected : ids[0];
			if (!view || !view.tavernHelper || !ids.length) return null;
			const h = React.createElement;
			const runtime = h("section", { className: "dsh-tavern-status-runtime" + (ids.length === 1 ? " single-panel" : "") },
				h("div", { className: "dsh-tavern-panel-toolbar" }, ids.length > 1 ? h("div", { className: "dsh-tavern-panel-tabs", role: "tablist", "aria-label": "人物卡面板" },
					statuses.concat(manual.map(function (entry) { return { viewId: entry.id, title: entry.title }; })).map(function (panel) {
						return h("button", { key: panel.viewId, role: "tab", type: "button", "aria-selected": active === panel.viewId,
							className: "dsh-tavern-panel-tab", onClick: function () { setSelected(panel.viewId); } }, panel.title || "角色状态");
					})) : null,
                    statuses.some(panel => panel.viewId === active) ? h("button", { type: "button", className: "dsh-tavern-panel-refresh", "aria-label": "放大面板", title: "全屏查看此面板", onClick: function (event) { expandTavernFrame(event.currentTarget.closest(".dsh-tavern-status-runtime")?.querySelector('[role="tabpanel"]:not([hidden])')); } }, "⤢") : null,
                    statuses.some(panel => panel.viewId === active) ? h("button", { type: "button", className: "dsh-tavern-panel-refresh", "aria-label": "刷新状态", title: "重新加载此面板，未保存的输入会清空", onClick: function () { tavernRetainedFrames.invalidatePanel(props.sessionId, active); setRefreshes(function (previous) { return Object.assign({}, previous, { [active]: (previous[active] || 0) + 1 }); }); } }, "↻") : null),
				statuses.map(function (statusView) { return h("div", { key: props.sessionId + statusView.viewId, role: "tabpanel", hidden: active !== statusView.viewId,
					"data-status-view-id": statusView.viewId, "data-template-revision": statusView.templateRevision },
					h(TavernMessageFrame, {
					key: props.sessionId + statusView.viewId + (refreshes[statusView.viewId] || 0),
					content: String(statusView.content), sessionId: props.sessionId,
					turn: Math.max(1, Number(statusView.targetTurn) || 1), partIndex: Math.max(0, Number(statusView.sourcePartIndex) || 0),
					panelId: statusView.viewId, helperContext: view.tavernHelper,
                    frameSizing: view.tavernRuntimePolicy?.frameSizing,
					trustedCardMode: Boolean(view.tavernRuntimePolicy && view.tavernRuntimePolicy.trustedCardMode),
					eager: true, persistent: true, executeSlash: props.executeSlash,
					observeMvuView: false, runtimeReporting: true
				})); }),
				manual.map(function (entry) { return h("div", { key: entry.id, role: "tabpanel", hidden: active !== entry.id },
					h("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { tavernPanelRegistry.pin(entry.id, false); } }, "返回正文栏"),
					h(TavernDockedPanel, { id: entry.id })); })
			);
			return props.section ? h("section", { className: "dsh-tavern-status-section" }, runtime) : runtime;
		}

		function latestTavernAssistantMessageId(snapshot) {
			// alpha.2 keeps message projections on Chat, separate from Session lifecycle.
			const nodes = snapshot && snapshot.legacy && snapshot.legacy.nodes || [];
			for (let index = nodes.length - 1; index >= 0; index -= 1) {
				if (nodes[index].kind === "assistant" && nodes[index].messageId) return nodes[index].messageId;
			}
			return null;
		}

		// @include turn-error-controls.js

		function createSupersededErrorProjection(root) {
			const owned = new Map();
			function restore(row, previous) {
				row.hidden = previous.hidden;
				if (row.style) row.style.display = previous.display;
			}
			function dispose() {
				for (const [row, previous] of owned) restore(row, previous);
				owned.clear();
			}
			function apply(turns) {
				const hidden = new Set(turns.map(String));
				const rows = root.querySelectorAll('[data-chat-flow-kind]');
				const keep = new Set();
				let pending = [];
				let failedTurn = "";
				function flush(turn) {
					for (const row of pending) {
						const owner = row.getAttribute("data-chat-turn") || turn;
						if (!hidden.has(owner)) continue;
						keep.add(row);
						if (!owned.has(row)) owned.set(row, { hidden: row.hidden, display: row.style && row.style.display });
						row.hidden = true;
						// Native process rows update `hidden` themselves when folding.
						// Keep suppression independent of that presentation state.
						if (row.style) row.style.display = "none";
					}
					pending = [];
				}
				for (const row of rows) {
					pending.push(row);
					const kind = row.getAttribute("data-chat-flow-kind");
					if (kind !== "turn-error" && kind !== "turn-tail") { failedTurn = ""; continue; }
					// Legacy rows have message IDs, not turn IDs. The terminal error or
					// tail anchors the whole turn, including its input and reasoning.
					// A failed tail can be empty, so inherit its preceding error's turn.
					const key = row.getAttribute("data-chat-flow-key") || "";
					const prefix = kind.length + ":" + kind;
					const keyTurn = key.startsWith(prefix) ? key.slice(prefix.length) : "";
					const tail = kind === "turn-tail" && row.querySelector ? row.querySelector("[data-turn-tail]") : null;
					const turn = row.getAttribute("data-chat-turn") || row.getAttribute("data-turn-tail") || (tail && tail.getAttribute("data-turn-tail")) || (/^\d+$/.test(keyTurn) ? keyTurn : "") || (kind === "turn-tail" ? failedTurn : "");
					flush(turn);
					failedTurn = kind === "turn-error" ? turn : "";
				}
				// alpha has explicit ownership even before its tail is mounted.
				flush("");
				for (const [row, previous] of owned) {
					if (!keep.has(row)) { restore(row, previous); owned.delete(row); }
				}
			}
			return { apply: apply, dispose: dispose };
		}
		// One owner for persisted suppression and legacy browser-only history records.
		// Kept in the loader bundle so DSH needs no new browser module protocol.
		function createTurnHistoryProjection(options) {
			options = options || {};
			const root = options.root || function () { return document; };
			const storage = options.storage || function () { return window.localStorage; };
        const hiddenRows = new Map();
        function hideRow(row) {
            if (!hiddenRows.has(row)) hiddenRows.set(row, row.style.display);
            row.style.display = "none";
        }
        function restoreHiddenRows() {
            for (const [row, previous] of hiddenRows) {
                if (row.style.display === "none") row.style.display = previous;
            }
            hiddenRows.clear();
        }
		const HIDDEN_TURNS_KEY = "dsh-tavern-hidden-turns";
		const ROLLED_BACK_TURNS_KEY = "dsh-tavern-rolled-back-turns";
		const HIDDEN_REGEN_USER_TURNS_KEY = "dsh-tavern-hidden-regen-user-turns";
		function forgetHiddenTurn(storageKey, sessionId, turn) {
			try {
				const all = JSON.parse(storage().getItem(storageKey) || "{}");
				const list = Array.isArray(all[sessionId]) ? all[sessionId].filter(function (item) { return Number(item) !== Number(turn); }) : [];
				if (list.length) all[sessionId] = list;
				else delete all[sessionId];
				storage().setItem(storageKey, JSON.stringify(all));
			} catch (err) {}
		}
		// Rows of the same turn before its tail, nearest first. Every DSH conversation row
		// carries data-chat-flow-kind; anything without it (pagination, host controls)
		// is outside the conversation and ends the turn as surely as the previous tail.
		function turnRowsBefore(tail, owner) {
			const rows = [];
			for (let sib = tail.previousElementSibling; sib; sib = sib.previousElementSibling) {
				const kind = sib.getAttribute("data-chat-flow-kind");
				if (!kind || kind === "turn-tail") break;
				const siblingTurn = sib.getAttribute("data-chat-turn");
				if (owner && siblingTurn && siblingTurn !== owner) break;
				rows.push(sib);
			}
			return rows;
		}
		// What opened a turn: the player's message, or the host's 「收到执行请求」 card
		// for a turn a plugin message woke (a regeneration attempt is one).
		function isTurnInputRow(row) {
			const kind = row.getAttribute("data-chat-flow-kind");
			return kind === "user" || kind === "turn-trigger";
		}
		// Rows up to, but not including, the turn's input.
		function turnReplyRowsBefore(tail, owner) {
			const rows = turnRowsBefore(tail, owner);
			const user = rows.findIndex(isTurnInputRow);
			return user === -1 ? rows : rows.slice(0, user);
		}
		function hideUserForTurnTail(tail) {
			if (!tail) return;
			const user = turnRowsBefore(tail, tailTurnOf(tail)).find(isTurnInputRow);
			if (user) hideRow(user);
		}
		function applyHiddenRegenUserTurns(sessionId) {
			try {
				const all = JSON.parse(storage().getItem(HIDDEN_REGEN_USER_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideUserForTurnTail(tail);
				}
			} catch (err) {}
		}
		function hideTurnTail(el) {
			if (!el) return;
			hideRow(el);
			turnReplyRowsBefore(el, tailTurnOf(el)).forEach(hideRow);
		}
		function showTurnTail(el) {
			if (!el) return;
			el.style.display = "";
			turnReplyRowsBefore(el, tailTurnOf(el)).forEach(function (row) { row.style.display = ""; });
		}
		function hideTurnTailWithUser(el) {
			if (!el) return;
			hideRow(el);
			// System prompts precede the user row. Hide through the turn boundary,
			// not just through its input; alpha also supplies explicit ownership.
			turnRowsBefore(el, el.getAttribute("data-chat-turn")).forEach(hideRow);
		}
		function tailTurnOf(el) {
			if (!el) return "";
			if (el.getAttribute("data-chat-turn")) return el.getAttribute("data-chat-turn");
			if (el.getAttribute("data-turn-tail")) return el.getAttribute("data-turn-tail");
			const inner = el.querySelector("[data-turn-tail]");
			return inner ? inner.getAttribute("data-turn-tail") : "";
		}
		function applyHiddenTurns(sessionId) {
			try {
				const all = JSON.parse(storage().getItem(HIDDEN_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideTurnTail(tail);
				}
			} catch (err) {}
		}
		function applyRolledBackTurns(sessionId) {
			try {
				const all = JSON.parse(storage().getItem(ROLLED_BACK_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideTurnTailWithUser(tail);
				}
			} catch (err) {}
		}
		function applySuppressedDshTurns(turns, regeneratedDshTurns) {
			const set = new Set((Array.isArray(turns) ? turns : []).map(String));
			if (set.size === 0) return;
			const visibleRegenerations = new Set(Object.values(regeneratedDshTurns && typeof regeneratedDshTurns === "object" ? regeneratedDshTurns : {}).map(String));
			const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
			for (let i = 0; i < tails.length; i++) {
				const tail = tails[i];
				const turn = tailTurnOf(tail);
				if (!set.has(turn)) continue;
				if (visibleRegenerations.has(turn)) {
					showTurnTail(tail);
					hideUserForTurnTail(tail);
				} else hideTurnTailWithUser(tail);
			}
		}
		// 重生成期间的那一楼：只藏会被替代的旧正文（和它的尾行），玩家输入留着。
		// 整轮隐掉输入会让页面看起来像"我刚发的那条被删了"，这是他自己的话。
		function hideReplacingReply(tail, turn) {
			hideRow(tail);
			const rows = turnRowsBefore(tail, turn);
			for (let i = 0; i < rows.length; i++) {
				if (rows[i].getAttribute("data-chat-flow-kind") === "user") continue;
				hideRow(rows[i]);
			}
		}
		function applyReplacingDshTurns(turns) {
			const set = new Set((Array.isArray(turns) ? turns : []).map(String));
			if (set.size === 0) return;
			const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
			for (let i = 0; i < tails.length; i++) {
				const tail = tails[i];
				const turn = tailTurnOf(tail);
				if (!set.has(turn)) continue;
				hideReplacingReply(tail, turn);
			}
		}
		function applyRegeneratedDshTurns(regeneratedDshTurns) {
			const mappings = regeneratedDshTurns && typeof regeneratedDshTurns === "object" ? regeneratedDshTurns : {};
			const hiddenStoryTurns = new Set(Object.keys(mappings).map(String));
			if (hiddenStoryTurns.size === 0) return;
			const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
			for (let i = 0; i < tails.length; i++) {
				const tail = tails[i];
				if (hiddenStoryTurns.has(tailTurnOf(tail))) hideTurnTail(tail);
			}
		}
		// 被替换掉的正文不会自己消失：宿主已经为那个原生回合画好了行，即使节点早已
		// 从消息面移除，重渲染也会把它再画出来。replacingDshTurns 只管生成那一刻，
		// regeneratedDshTurns 的键是剧情轮次、宿主行上是原生轮次，两边对不上。
		// 这里按服务端从日志里算出的「曾被替换的正文所在原生回合」隐藏，只藏回复，
		// 玩家输入永远留着。刷新后照样生效，因为它来自日志而不是内存标记。
		function applySupersededDshTurns(turns) {
			const set = new Set((Array.isArray(turns) ? turns : []).map(String));
			if (set.size === 0) return;
			const rows = root().querySelectorAll('[data-chat-turn]');
			for (let i = 0; i < rows.length; i++) {
				const row = rows[i];
				if (!set.has(row.getAttribute("data-chat-turn"))) continue;
				if (row.getAttribute("data-chat-flow-kind") === "user") continue;
				hideRow(row);
			}
		}
		// Row plan comparison (docs/design/transcript-row-plan.md, step 2): the page still
		// follows the hiding lists; this only reports rows the plan would show differently.
		// The plan holds exceptions only, keyed by native turn: an absent turn shows its own
		// input and reply. Same rule as planShowsRow in lib/domain/transcript-row-plan.js.
		function tavernPlanShowsRow(plan, turnValue, kind) {
			if (!plan || !plan.turns || turnValue === null || turnValue === "") return true;
			// Before a windowed plan's first round: not judged.
			if (plan.from !== null && plan.from !== undefined && Number(turnValue) < plan.from) return null;
			const entry = plan.turns[String(turnValue)];
			if (!entry) return true;
			return kind === "user" || kind === "turn-trigger" ? entry.input === 1 : entry.reply === 1;
		}
		const reportedPlanDiffs = new Map();
		function compareRowPlan(sessionId, plan) {
			if (!plan || !plan.turns) return;
			const diffs = [];
			for (const row of root().querySelectorAll('[data-chat-flow-kind][data-chat-turn]')) {
				const kind = row.getAttribute("data-chat-flow-kind");
				if (kind === "context") continue;
				const planned = tavernPlanShowsRow(plan, row.getAttribute("data-chat-turn"), kind);
				const shown = row.style.display !== "none";
				if (planned !== null && planned !== shown) diffs.push(row.getAttribute("data-chat-turn") + ":" + kind + ":" + (shown ? "现行显示" : "现行隐藏"));
			}
			const key = diffs.join(",");
			if (reportedPlanDiffs.get(sessionId) === key) return;
			reportedPlanDiffs.set(sessionId, key);
			if (diffs.length) console.debug("dsh-tavern 行计划对照：与现行隐藏不同的行", { sessionId: sessionId, rows: diffs });
		}
			function apply(sessionId, turns, regeneratedDshTurns, replacingTurns, supersededTurns, rowPlan) {
                // Reconcile both directions: an older observer may have hidden a
                // restored turn after the action's immediate DOM update.
                restoreHiddenRows();
				applySuppressedDshTurns(turns, regeneratedDshTurns);
				applyReplacingDshTurns(replacingTurns);
				applyRegeneratedDshTurns(regeneratedDshTurns);
				applySupersededDshTurns(supersededTurns);
                // Native rows can mount without their turn tail. Explicit ownership
                // must remain authoritative during streaming and partial hydration.
                const suppressed = new Set((Array.isArray(turns) ? turns : []).map(String));
                const replacing = new Set((Array.isArray(replacingTurns) ? replacingTurns : []).map(String));
                const mappings = regeneratedDshTurns || {};
                const replacements = new Set(Object.values(mappings).map(String));
                for (const row of root().querySelectorAll('[data-chat-turn]')) {
                    const turn = row.getAttribute("data-chat-turn");
                    const kind = row.getAttribute("data-chat-flow-kind");
                    if (!kind) continue;
                    // 正在被替换的那一楼只藏回复，玩家的输入永远留着。
                    if (replacing.has(turn) && kind === "user") continue;
                    // A void turn that now carries the round's body keeps its reply and
                    // drops only what opened it (the player's input or the trigger card).
                    if (suppressed.has(turn) && (!replacements.has(turn) || isTurnInputRow(row))) hideRow(row);
                    // mappings 的键是剧情轮次，宿主行上是原生轮次；用键去匹配这里的
                    // turn 只会在两个编号碰巧相等时误藏，真正的替换由 superseded 负责。
                }
				applyHiddenTurns(sessionId);
				applyRolledBackTurns(sessionId);
				applyHiddenRegenUserTurns(sessionId);
                for (const row of root().querySelectorAll('[data-chat-flow-kind="context"]')) {
                    const source = row.querySelector('[data-context-source]');
                    if (source && source.textContent.trim() === "dsh-tavern-surface-restore") hideRow(row);
                }
                compareRowPlan(sessionId, rowPlan);
			}
			function regenerated(sessionId, view, tail) {
				const adopted = view && view.adopted;
				if (adopted && Number(adopted.hiddenTurn) > 0) forgetHiddenTurn(HIDDEN_TURNS_KEY, sessionId, Number(adopted.hiddenTurn));
				if (adopted && Number(adopted.syntheticTurn) > 0) forgetHiddenTurn(HIDDEN_REGEN_USER_TURNS_KEY, sessionId, Number(adopted.syntheticTurn));
				apply(sessionId, view && view.suppressedDshTurns, view && view.regeneratedDshTurns, view && view.replacingDshTurns, view && view.supersededDshTurns, view && { turns: view.transcriptTurns, from: view.transcriptFrom });
			}
            function restored(sessionId, view) {
                const turn = Number(view && view.undoneRollback && view.undoneRollback.turn);
                const turns = [turn].concat(Object.values(view && view.regeneratedDshTurns || {})).map(String);
                for (const restoredTurn of turns) {
                    forgetHiddenTurn(ROLLED_BACK_TURNS_KEY, sessionId, restoredTurn);
                    forgetHiddenTurn(HIDDEN_TURNS_KEY, sessionId, restoredTurn);
                }
                const tails = root().querySelectorAll('[data-chat-flow-kind="turn-tail"]');
                for (const tail of tails) {
                    if (!turns.includes(tailTurnOf(tail))) continue;
                    tail.style.display = "";
                    turnRowsBefore(tail, tail.getAttribute("data-chat-turn")).forEach(function (row) { row.style.display = ""; });
                }
                apply(sessionId, view && view.suppressedDshTurns, view && view.regeneratedDshTurns, view && view.replacingDshTurns, view && view.supersededDshTurns, view && { turns: view.transcriptTurns, from: view.transcriptFrom });
            }
			function rolledBack(sessionId, view) {
				apply(sessionId, view && view.suppressedDshTurns, view && view.regeneratedDshTurns, view && view.replacingDshTurns, view && view.supersededDshTurns, view && { turns: view.transcriptTurns, from: view.transcriptFrom });
			}
			return Object.freeze({ apply: apply, regenerated: regenerated, rolledBack: rolledBack, restored: restored });
		}
		function applyBodyRegenerationResult(options) {
			options.liveTavernView.setView(options.sessionId, options.view);
			options.historyProjection.regenerated(options.sessionId, options.view, options.tail);
		}

		function resolveConversationChatBinding(uiConversation, binding) {
			if (uiConversation && typeof uiConversation.binding === "function") {
				return uiConversation.binding(binding).target("chat");
			}
			if (!binding || !binding.session || typeof binding.session.subscribe !== "function" || typeof binding.session.getSnapshot !== "function") {
				throw new Error("当前 DSHA 无法提供酒馆状态所需的对话消息");
			}
			return {
				subscribe: function (listener) { return binding.session.subscribe(listener); },
				getSnapshot: function () {
					const snapshot = binding.session.getSnapshot();
					if (!snapshot || !snapshot.chat) throw new Error("当前 DSHA 的对话消息尚未就绪");
					return snapshot.chat;
				}
			};
		}
