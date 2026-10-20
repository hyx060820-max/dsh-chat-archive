window.__ModuleLoader__.load({
	id: "dsh-memory",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const h = react.createElement;

		const API = "/dsh-memory";

		const STYLES = `
.dsh-mem-root { display: flex; flex-direction: column; gap: 14px; }
/* 用中性灰 + 透明度，浅色深色都看得清。原来写的是白色透明，浅色主题下等于没边框 */
.dsh-mem-card { border: 1px solid rgba(127,127,127,.32); border-radius: 10px; padding: 14px 16px; background: rgba(127,127,127,.04); }
.dsh-mem-card.off { opacity: .55; }
.dsh-mem-row { display: flex; align-items: center; gap: 10px; }
.dsh-mem-grow { flex: 1; min-width: 0; }
.dsh-mem-name { font-weight: 600; font-size: 13px; }
.dsh-mem-meta { font-size: 12px; opacity: .65; margin-top: 2px; }
.dsh-mem-sw { position: relative; width: 38px; height: 21px; flex: none; cursor: pointer; display: inline-block; }
.dsh-mem-sw input { position: absolute; opacity: 0; width: 0; height: 0; }
.dsh-mem-sw i { position: absolute; inset: 0; background: rgba(127,127,127,.35); border-radius: 999px; transition: background .15s; }
.dsh-mem-sw i::after { content: ""; position: absolute; top: 3px; left: 3px; width: 15px; height: 15px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .15s; }
.dsh-mem-sw input:checked + i { background: rgba(200,118,63,.75); }
.dsh-mem-sw input:checked + i::after { transform: translateX(17px); }
.dsh-mem-wshead { display: flex; align-items: center; gap: 8px; margin: 12px 0 4px; padding-top: 10px; border-top: 1px solid rgba(127,127,127,.22); font-size: 12px; opacity: .8; }
.dsh-mem-list { max-height: 220px; overflow: auto; }
.dsh-mem-ws { display: flex; align-items: center; gap: 9px; padding: 6px 6px; border-radius: 6px; cursor: pointer; font-size: 12.5px; }
.dsh-mem-ws:hover { background: rgba(127,127,127,.12); }
.dsh-mem-ws input { accent-color: #c8763f; width: 14px; height: 14px; flex: none; }
.dsh-mem-ws .p { font-family: ui-monospace, Consolas, monospace; }
.dsh-mem-ws .t { margin-left: auto; opacity: .6; font-size: 11.5px; white-space: nowrap; }
.dsh-mem-field { display: block; margin-top: 10px; }
.dsh-mem-field span { display: block; font-size: 12px; opacity: .7; margin-bottom: 5px; }
.dsh-mem-field input { width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 7px; background: rgba(127,127,127,.07); border: 1px solid rgba(127,127,127,.35); color: inherit; font: inherit; font-size: 13px; }
.dsh-mem-field input:focus { outline: none; border-color: #c8763f; }
.dsh-mem-field textarea {
  width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 7px;
  background: rgba(127,127,127,.07); border: 1px solid rgba(127,127,127,.35);
  color: inherit; font: inherit; font-size: 13px; resize: vertical; min-height: 62px;
}
.dsh-mem-field textarea:focus { outline: none; border-color: #c8763f; }
.dsh-mem-link { color: inherit; opacity: .7; font-size: 12px; }
.dsh-mem-link:hover { opacity: 1; }
.dsh-mem-bar { display: flex; align-items: center; gap: 10px; }
.dsh-mem-btn { font: inherit; font-size: 13px; padding: 7px 15px; border-radius: 7px; border: 1px solid rgba(127,127,127,.4); background: rgba(127,127,127,.09); color: inherit; cursor: pointer; }
.dsh-mem-btn.primary { background: #c8763f; border-color: #c8763f; color: #1a1206; font-weight: 600; }
.dsh-mem-btn:disabled { opacity: .5; cursor: default; }
.dsh-mem-fill {
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 12px; margin-right: 6px;
  border-radius: 999px; border: 1px solid rgba(127,127,127,.26);
  background: transparent; color: inherit;
  font: inherit; font-size: 12.5px; line-height: 1; white-space: nowrap;
  opacity: .75; cursor: pointer;
  transition: background .15s, border-color .15s, opacity .15s;
}
.dsh-mem-fill:hover { background: rgba(127,127,127,.12); border-color: rgba(127,127,127,.45); opacity: 1; }
.dsh-mem-fill:active { background: rgba(127,127,127,.18); }
.dsh-mem-fill.used { opacity: .45; }
.dsh-mem-fill.used:hover { opacity: 1; }
.dsh-mem-fill.done { border-color: rgba(200,118,63,.65); background: rgba(200,118,63,.14); opacity: 1; }
.dsh-mem-hint { font-size: 12px; opacity: .7; }
.dsh-mem-note { padding: 12px 14px; border-radius: 10px; border: 1px dashed rgba(127,127,127,.45); background: rgba(200,118,63,.07); }
.dsh-mem-note-t { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
.dsh-mem-note-d { font-size: 12px; line-height: 1.65; opacity: .85; }
.dsh-mem-pre {
  margin: 10px 0 0; padding: 10px 12px; border-radius: 8px;
  background: rgba(127,127,127,.07);
  border: 1px solid rgba(127,127,127,.38);
  color: inherit;
  font: 12px/1.6 ui-monospace, Consolas, monospace;
  white-space: pre-wrap; max-height: 260px; overflow: auto;
}
`;

		const rel = (ms) => {
			if (!ms) return "从没动过";
			const m = Math.floor((Date.now() - ms) / 60000);
			if (m < 1) return "刚刚";
			if (m < 60) return m + " 分钟前";
			if (m < 1440) return Math.floor(m / 60) + " 小时前";
			return Math.floor(m / 1440) + " 天前";
		};

		async function getJson(path, init) {
			const r = await fetch(API + path, Object.assign({ headers: { "content-type": "application/json" } }, init));
			const d = await r.json();
			if (!r.ok || d.ok === false) throw new Error(d.error || ("HTTP " + r.status));
			return d;
		}

		function Switch(props) {
			return h(
				"label",
				{ className: "dsh-mem-sw", title: props.title || "" },
				h("input", { type: "checkbox", checked: !!props.checked, onChange: (e) => props.onChange(e.target.checked) }),
				h("i"),
			);
		}

		function MemoryPanel() {
			const [st, setSt] = react.useState(null);
			const [err, setErr] = react.useState("");
			const [hint, setHint] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [startupMsg, setStartupMsg] = react.useState("");
			const [checkMsg, setCheckMsg] = react.useState("");
			const [feedText, setFeedText] = react.useState("");
			const [result, setResult] = react.useState(null);

			const load = () =>
				getJson("/state")
					.then((d) => {
						setSt(d);
						setBtnShow(d.settings?.button?.show);
						setErr("");
					})
					.catch((e) => setErr(String(e.message || e)));

			react.useEffect(() => {
				load();
			}, []);

			if (err) return h("div", { className: "dsh-mem-root" }, h("div", { className: "dsh-mem-hint" }, "连不上插件服务：" + err));
			if (!st) return h("div", { className: "dsh-mem-root" }, h("div", { className: "dsh-mem-hint" }, "读取中…"));

			const s = st.settings;
			const mutate = (fn) => {
				const next = JSON.parse(JSON.stringify(s));
				fn(next);
				setSt(Object.assign({}, st, { settings: next }));
				setHint("有改动没保存");
			};

			const save = async () => {
				try {
					const d = await getJson("/settings", { method: "POST", body: JSON.stringify({ settings: s }) });
					setSt(Object.assign({}, st, { settings: d.settings }));
					setHint("");
					return true;
				} catch (e) {
					setHint("保存失败：" + (e.message || e));
					return false;
				}
			};


			const checkUpdate = async () => {
				setCheckMsg("查着…");
				try {
					const d = await getJson("/update");
					if (!d.ok) return setCheckMsg("查不到：" + (d.error || "未知原因"));
					setCheckMsg(d.latest === d.current ? "已是最新" : "有新版本 v" + d.latest + "（当前 v" + d.current + "）");
				} catch (e) {
					setCheckMsg("查不到：" + (e.message || e));
				}
			};

			const sendFeedback = () => {
				const text = feedText.trim();
				if (!text) return;
				const body = [
					"## 想说的",
					text,
					"",
					"## 环境",
					"- 插件版本：" + (st.version || "?"),
					"- Node：" + (st.node || "?"),
					"- 系统：" + (navigator.platform || "?"),
				].join("\n");
				const url = (st.repoUrl || "") + "/issues/new?title=" + encodeURIComponent("反馈：" + text.slice(0, 40)) + "&body=" + encodeURIComponent(body);
				window.open(url, "_blank", "noopener");
			};

			const run = async () => {
				setBusy(true);
				setResult(null);
				try {
					if (!(await save())) return;
					const d = await getJson("/run", { method: "POST", body: "{}" });
					setResult(d);
					await load();
				} catch (e) {
					setResult({ ok: false, results: [{ format: "-", code: -1, out: String(e.message || e) }] });
				} finally {
					setBusy(false);
				}
			};

			const applyStartup = async () => {
				setBusy(true);
				try {
					if (!(await save())) return;
					const d = await getJson("/startup", { method: "POST", body: JSON.stringify({ enabled: !!s.startup.enabled }) });
					const n = (d.results || []).filter((r) => r.changed).length;
					setStartupMsg((s.startup.enabled ? "写入 " : "撤掉 ") + n + " 个，共 " + (d.results || []).length + " 个选中工作区");
					await load();
				} catch (e) {
					setStartupMsg("失败：" + (e.message || e));
				} finally {
					setBusy(false);
				}
			};

			const sd = s.sources.dsh;
			const ws = (st.dsh && st.dsh.workspaces) || [];
			const total = ws.reduce((a, b) => a + b.sessions, 0);

			return h(
				"div",
				{ className: "dsh-mem-root" },
				// 顶部说明
				h(
					"div",
					{ className: "dsh-mem-note" },
					h("div", { className: "dsh-mem-note-t" }, "这份账本，配人格才活"),
					h(
						"div",
						{ className: "dsh-mem-note-d" },
						"归档只负责把说过的话留下。配上人格——那个跟你说话的角色——它才会去翻，",
						"才会在你说「上次不是说过」的时候真的找到，而不是含糊过去。",
					),
				),
				// DSH
				h(
					"div",
					{ className: "dsh-mem-card" + (sd.enabled ? "" : " off") },
					h(
						"div",
						{ className: "dsh-mem-row" },
						h(
							"div",
							{ className: "dsh-mem-grow" },
							h("div", { className: "dsh-mem-name" }, "DSH 会话"),
							h("div", { className: "dsh-mem-meta" }, st.dsh.exists ? ws.length + " 个工作区，共 " + total + " 个会话" : "没找到会话目录"),
						),
						h(Switch, { checked: sd.enabled, title: "启用 DSH", onChange: (v) => mutate((n) => { n.sources.dsh.enabled = v; }) }),
					),
					h(
						"div",
						{ className: "dsh-mem-wshead" },
						h(
							"label",
							{ className: "dsh-mem-ws", style: { padding: 0 } },
							h("input", {
								type: "checkbox",
								checked: sd.all,
								onChange: (e) => mutate((n) => { n.sources.dsh.all = e.target.checked; }),
							}),
							"全部工作区",
						),
						h("span", { style: { marginLeft: "auto" } }, sd.all ? "全都要" : sd.workspaces.length ? "选了 " + sd.workspaces.length + " 个" : "一个都没选"),
					),
					h(
						"div",
						{ className: "dsh-mem-list" },
						ws.length === 0
							? h("div", { className: "dsh-mem-hint" }, "这里没有工作区")
							: ws.map((w) => {
									const on = sd.all || sd.workspaces.indexOf(w.name) >= 0;
									return h(
										"label",
										{ className: "dsh-mem-ws", key: w.name, title: w.name },
										h("input", {
											type: "checkbox",
											checked: on,
											disabled: sd.all || !sd.enabled,
											onChange: (e) =>
												mutate((n) => {
													const arr = n.sources.dsh.workspaces;
													const i = arr.indexOf(w.name);
													if (e.target.checked && i < 0) arr.push(w.name);
													if (!e.target.checked && i >= 0) arr.splice(i, 1);
												}),
										}),
										h("span", { className: "p" }, w.label || w.name),
										h("span", { className: "t" }, w.sessions + " 个会话 · " + rel(w.last)),
									);
								}),
					),
				),
				// 输入框按钮的显隐
				h(
					"div",
					{ className: "dsh-mem-card" + (s.button.show ? "" : " off") },
					h(
						"div",
						{ className: "dsh-mem-row" },
						h(
							"div",
							{ className: "dsh-mem-grow" },
							h("div", { className: "dsh-mem-name" }, "输入框里显示「读关于我」"),
							h(
								"div",
								{ className: "dsh-mem-meta" },
								s.button.show ? "输入框右边有这个按钮" : "藏起来，输入框右边只剩模型选择",
							),
						),
						h(Switch, {
							checked: !!s.button.show,
							title: "显示/隐藏输入框按钮",
							onChange: (v) => { mutate((n) => { n.button.show = v; }); setBtnShow(v); },
						}),
					),
					h(
						"div",
						{ className: "dsh-mem-hint", style: { marginTop: 8 } },
						"只是藏起来，功能还在。一个对话每天一次就够——掉细节的时候补，不用每轮点。",
					),
				),
				// 关于我
				h(
					"div",
					{ className: "dsh-mem-card" },
					h(
						"div",
						{ className: "dsh-mem-row" },
						h(
							"div",
							{ className: "dsh-mem-grow" },
							h("div", { className: "dsh-mem-name" }, "关于我"),
							h(
								"div",
								{ className: "dsh-mem-meta" },
								st.me && st.me.exists
									? "最后改于 " + new Date(st.me.mtime).toLocaleString("zh-CN")
									: "还没有。对 agent 说「记一下：我讨厌坐车」就会建起来",
							),
						),
					),
					st.me && st.me.exists
						? h("pre", { className: "dsh-mem-pre", style: { maxHeight: 180 } }, st.me.text)
						: null,
				),
				// 启动时读取关于我
				h(
					"div",
					{ className: "dsh-mem-card" + (s.startup.enabled ? "" : " off") },
					h(
						"div",
						{ className: "dsh-mem-row" },
						h(
							"div",
							{ className: "dsh-mem-grow" },
							h("div", { className: "dsh-mem-name" }, "启动时读取关于我"),
							h(
								"div",
								{ className: "dsh-mem-meta" },
								st.startup && st.startup.items
									? (st.startup.applied
										? "已写入 " + st.startup.items.length + " 个工作区"
										: "已写入 " + st.startup.items.filter((i) => i.applied).length + " / " + st.startup.items.length + " 个")
									: "按上面勾选的工作区",
							),
						),
						h(Switch, {
							checked: !!s.startup.enabled,
							title: "启动时读取关于我",
							onChange: (v) => mutate((n) => { n.startup.enabled = v; }),
						}),
					),
					h(
						"div",
						{ className: "dsh-mem-hint", style: { marginTop: 8 } },
						"只对「新开」的对话有用：把档案原文写进 AGENTS.md，新对话第一轮就带着它。已经在聊的那个不吃这套——掉细节时点输入框旁边的按钮。",
					),
					h(
						"div",
						{ className: "dsh-mem-bar", style: { marginTop: 10 } },
						h("button", { className: "dsh-mem-btn", disabled: busy, onClick: applyStartup }, s.startup.enabled ? "写入工作区" : "撤掉"),
						h("span", { className: "dsh-mem-hint" }, startupMsg),
					),
				),
				// 自动备份
				h(
					"div",
					{ className: "dsh-mem-card" + (s.schedule.enabled ? "" : " off") },
					h(
						"div",
						{ className: "dsh-mem-row" },
						h(
							"div",
							{ className: "dsh-mem-grow" },
							h("div", { className: "dsh-mem-name" }, "自动备份"),
							h(
								"div",
								{ className: "dsh-mem-meta" },
								s.schedule.enabled
									? "每天 " + s.schedule.at + " 跑一次（DSH 开着的时候）"
									: "关着。只有点上面的按钮才跑",
							),
						),
						h(Switch, {
							checked: s.schedule.enabled,
							title: "启用自动备份",
							onChange: (v) => mutate((n) => { n.schedule.enabled = v; }),
						}),
					),
					h(
						"label",
						{ className: "dsh-mem-field" },
						h("span", null, "时间（HH:mm）"),
						h("input", {
							value: s.schedule.at,
							placeholder: "23:00",
							onChange: (e) => mutate((n) => { n.schedule.at = e.target.value; }),
						}),
					),
					s.schedule.lastRun
						? h(
								"div",
								{ className: "dsh-mem-hint", style: { marginTop: 8 } },
								"上次自动：" + s.schedule.lastRun.day + " · " + (s.schedule.lastRun.ok ? "成功" : "有问题"),
								s.schedule.lastRun.note ? "（" + s.schedule.lastRun.note + "）" : "",
							)
						: null,
				),
				// 输出设置
				h(
					"div",
					{ className: "dsh-mem-card" },
					h("div", { className: "dsh-mem-name" }, "输出"),
					h(
						"label",
						{ className: "dsh-mem-field" },
						h("span", null, "存档目录"),
						h("input", { value: s.root, onChange: (e) => mutate((n) => { n.root = e.target.value; }) }),
					),
					h(
						"label",
						{ className: "dsh-mem-field" },
						h("span", null, "脚本目录（留空 = 用插件包里自带的那份）"),
						h("input", { value: s.repo, onChange: (e) => mutate((n) => { n.repo = e.target.value; }) }),
					),
					h(
						"div",
						{ style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" } },
						h(
							"label",
							{ className: "dsh-mem-field" },
							h("span", null, "助手显示名"),
							h("input", { value: s.assistantName, onChange: (e) => mutate((n) => { n.assistantName = e.target.value; }) }),
						),
						h(
							"label",
							{ className: "dsh-mem-field" },
							h("span", null, "用户显示名"),
							h("input", { value: s.userName, onChange: (e) => mutate((n) => { n.userName = e.target.value; }) }),
						),
					),
				),
				// 版本与反馈
				h(
					"div",
					{ className: "dsh-mem-card" },
					h(
						"div",
						{ className: "dsh-mem-row" },
						h(
							"div",
							{ className: "dsh-mem-grow" },
							h("div", { className: "dsh-mem-name" }, "版本与反馈"),
							h(
								"div",
								{ className: "dsh-mem-meta" },
								"当前 v" + (st.version || "?") + (checkMsg ? " · " + checkMsg : ""),
							),
						),
						h("button", { className: "dsh-mem-btn", onClick: checkUpdate }, "检查更新"),
					),
					h(
						"label",
						{ className: "dsh-mem-field" },
						h("span", null, "留言（点提交会在 GitHub 开一个 issue）"),
						h("textarea", {
							rows: 3,
							value: feedText,
							placeholder: "哪里不好用、想要什么",
							onChange: (e) => setFeedText(e.target.value),
						}),
					),
					h(
						"div",
						{ className: "dsh-mem-bar", style: { marginTop: 10 } },
						h("button", { className: "dsh-mem-btn", disabled: !feedText.trim(), onClick: sendFeedback }, "在 GitHub 上提交"),
						h("a", { className: "dsh-mem-link", href: st.repoUrl || "#", target: "_blank", rel: "noopener" }, "项目地址"),
					),
				),
				// 动作
				h(
					"div",
					{ className: "dsh-mem-bar" },
					h("button", { className: "dsh-mem-btn primary", disabled: busy, onClick: run }, busy ? "跑着…" : "立即备份"),
					h("button", { className: "dsh-mem-btn", disabled: busy, onClick: async () => { if (await save()) await load(); } }, "保存"),
					h("span", { className: "dsh-mem-hint" }, hint),
				),
				// 结果
				result
					? h(
							"div",
							null,
							(result.results || []).map((r, i) =>
								h(
									"div",
									{ key: i },
									h("div", { className: "dsh-mem-hint", style: { marginTop: 8 } }, r.format + " · 退出码 " + r.code),
									h("pre", { className: "dsh-mem-pre" }, r.out || "（没有输出）"),
								),
							),
							result.lastLog ? h("pre", { className: "dsh-mem-pre" }, result.lastLog.text) : null,
						)
					: st.lastLog
						? h("pre", { className: "dsh-mem-pre" }, st.lastLog.text)
						: null,
			);
		}

		// ── 输入框右边的「读关于我」按钮 ──
		// 只负责把话填进输入框，不替你发送。
		// 发送要 sessionId，而插槽不给——那个接口是内部结构，不碰。
		const FILL_TEXT = "看一下关于我";

		function fillComposer(text) {
			const editable = (el) =>
				el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);

			let el = editable(document.activeElement) ? document.activeElement : null;
			if (!el) {
				const all = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(
					(n) => n.offsetParent !== null,
				);
				el = all[all.length - 1];
			}
			if (!el) return false;

			el.focus();
			if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
				const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
				const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
				setter.call(el, text);
				el.dispatchEvent(new Event("input", { bubbles: true }));
				return true;
			}
			// contenteditable 编辑器：优先用插入文本，保住它自己的状态
			try {
				document.execCommand("insertText", false, text);
				if ((el.textContent || "").includes(text)) return true;
			} catch {
				/* 继续往下兜底 */
			}
			el.textContent = text;
			el.dispatchEvent(new InputEvent("input", { bubbles: true }));
			return true;
		}

		// 输入框那个按钮的显示状态：设置里改了，按钮当场跟着变，不用重启
		const btnShow = { value: true, subs: new Set() };
		const setBtnShow = (v) => {
			const next = v !== false;
			if (btnShow.value === next) return;
			btnShow.value = next;
			for (const f of btnShow.subs) f();
		};
		function useBtnShow() {
			const [, bump] = react.useState(0);
			react.useEffect(() => {
				const f = () => bump((n) => n + 1);
				btnShow.subs.add(f);
				return () => btnShow.subs.delete(f);
			}, []);
			return btnShow.value;
		}

		const LAST_KEY = "dsh-memory:lastFill";
		const today = () => {
			const d = new Date();
			const p = (n) => String(n).padStart(2, "0");
			return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
		};
		const filledToday = () => {
			try {
				return localStorage.getItem(LAST_KEY) === today();
			} catch {
				return false;
			}
		};

		function ReadButton() {
			const show = useBtnShow();
			const [done, setDone] = react.useState(false);
			const [failed, setFailed] = react.useState(false);
			const [todayDone, setTodayDone] = react.useState(filledToday);
			const click = () => {
				const ok = fillComposer(FILL_TEXT);
				setFailed(!ok);
				setDone(ok);
				if (ok) {
					try {
						localStorage.setItem(LAST_KEY, today());
					} catch {
						/* 存不了就算了 */
					}
					setTodayDone(true);
				}
				setTimeout(() => {
					setDone(false);
					setFailed(false);
				}, 1800);
			};
			const tip = todayDone
				? "今天已经填过一次了。要再补也行，一天一次通常就够"
				: "一个对话每天一次就够。把「" + FILL_TEXT + "」填进输入框，回车发送";
			if (!show) return null;
			const label = failed ? "没找到输入框" : done ? "已填入，回车" : "读关于我";
			return h("button", { className: "dsh-mem-fill" + (done ? " done" : "") + (todayDone && !done ? " used" : ""), onClick: click, title: tip }, label);
		}
		const inject = ["slots"];

		function apply(ctx) {
			// 样式在插件加载时就挂上，不等谁去打开设置页。
			// 之前放在设置面板的 effect 里，没见过设置页的人就看不到样式。
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-memory";
				style.textContent = STYLES;
				document.head.appendChild(style);
				return () => style.remove();
			});

			ctx.slots.inject("conversation.input.right", () =>
				ctx.slots.register(
					{ name: "conversation.input.right", id: "dsh-memory-fill", order: 200, label: () => "读关于我" },
					ReadButton,
				),
			);
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "dsh-memory",
						order: 17,
						label: () => "记忆体",
					},
					MemoryPanel,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
