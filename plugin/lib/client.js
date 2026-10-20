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
.dsh-mem-card { border: 1px solid rgba(255,255,255,.09); border-radius: 10px; padding: 14px 16px; }
.dsh-mem-card.off { opacity: .55; }
.dsh-mem-row { display: flex; align-items: center; gap: 10px; }
.dsh-mem-grow { flex: 1; min-width: 0; }
.dsh-mem-name { font-weight: 600; font-size: 13px; }
.dsh-mem-meta { font-size: 12px; opacity: .6; margin-top: 2px; }
.dsh-mem-sw { position: relative; width: 38px; height: 21px; flex: none; cursor: pointer; display: inline-block; }
.dsh-mem-sw input { position: absolute; opacity: 0; width: 0; height: 0; }
.dsh-mem-sw i { position: absolute; inset: 0; background: rgba(255,255,255,.14); border-radius: 999px; transition: background .15s; }
.dsh-mem-sw i::after { content: ""; position: absolute; top: 3px; left: 3px; width: 15px; height: 15px; border-radius: 50%; background: #8b93a3; transition: transform .15s, background .15s; }
.dsh-mem-sw input:checked + i { background: rgba(200,118,63,.35); }
.dsh-mem-sw input:checked + i::after { transform: translateX(17px); background: #c8763f; }
.dsh-mem-wshead { display: flex; align-items: center; gap: 8px; margin: 12px 0 4px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.07); font-size: 12px; opacity: .75; }
.dsh-mem-list { max-height: 220px; overflow: auto; }
.dsh-mem-ws { display: flex; align-items: center; gap: 9px; padding: 6px 6px; border-radius: 6px; cursor: pointer; font-size: 12.5px; }
.dsh-mem-ws:hover { background: rgba(255,255,255,.05); }
.dsh-mem-ws input { accent-color: #c8763f; width: 14px; height: 14px; flex: none; }
.dsh-mem-ws .p { font-family: ui-monospace, Consolas, monospace; }
.dsh-mem-ws .t { margin-left: auto; opacity: .55; font-size: 11.5px; white-space: nowrap; }
.dsh-mem-field { display: block; margin-top: 10px; }
.dsh-mem-field span { display: block; font-size: 12px; opacity: .65; margin-bottom: 5px; }
.dsh-mem-field input { width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 7px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); color: inherit; font: inherit; font-size: 13px; }
.dsh-mem-field input:focus { outline: none; border-color: #c8763f; }
.dsh-mem-bar { display: flex; align-items: center; gap: 10px; }
.dsh-mem-btn { font: inherit; font-size: 13px; padding: 7px 15px; border-radius: 7px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: inherit; cursor: pointer; }
.dsh-mem-btn.primary { background: #c8763f; border-color: #c8763f; color: #1a1206; font-weight: 600; }
.dsh-mem-btn:disabled { opacity: .5; cursor: default; }
.dsh-mem-hint { font-size: 12px; opacity: .6; }
.dsh-mem-pre { margin: 10px 0 0; padding: 10px 12px; border-radius: 8px; background: rgba(0,0,0,.35); font: 12px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; max-height: 260px; overflow: auto; }
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
			const [result, setResult] = react.useState(null);

			const load = () =>
				getJson("/state")
					.then((d) => {
						setSt(d);
						setErr("");
					})
					.catch((e) => setErr(String(e.message || e)));

			react.useEffect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-memory";
				style.textContent = STYLES;
				document.head.appendChild(style);
				load();
				return () => style.remove();
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

			const sd = s.sources.dsh;
			const sc = s.sources.codex;
			const ws = (st.dsh && st.dsh.workspaces) || [];
			const total = ws.reduce((a, b) => a + b.sessions, 0);

			return h(
				"div",
				{ className: "dsh-mem-root" },
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
				// Codex
				h(
					"div",
					{ className: "dsh-mem-card" + (sc.enabled ? "" : " off") },
					h(
						"div",
						{ className: "dsh-mem-row" },
						h(
							"div",
							{ className: "dsh-mem-grow" },
							h("div", { className: "dsh-mem-name" }, "Codex CLI 会话"),
							h("div", { className: "dsh-mem-meta" }, sc.enabled ? "会一起备份" : "关着，一次都不跑"),
						),
						h(Switch, { checked: sc.enabled, title: "启用 Codex", onChange: (v) => mutate((n) => { n.sources.codex.enabled = v; }) }),
					),
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
						h("span", null, "脚本目录（backup-chat.ps1 所在）"),
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

		const inject = ["slots"];

		function apply(ctx) {
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
