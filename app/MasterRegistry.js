"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Factory, RefreshCw, Search } from "lucide-react";
import AppNav from "./AppNav";
import { supabase } from "../lib/supabase";

const configs = {
  client: { title: "거래처", table: "clients", code: "client_code", name: "client_name", example: "예: C001" },
  item: { title: "품목", table: "items", code: "item_code", name: "item_name", example: "예: ITEM001" },
  material: { title: "원재료", table: "raw_materials", code: "raw_code", name: "raw_name", example: "예: RAW001" },
};

export default function MasterRegistry({ kind }) {
  const config = configs[kind];
  const [rows, setRows] = useState([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.");
      let all = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await supabase.from(config.table).select(`${config.code},${config.name}`).order(config.code).range(start, start + 999);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < 1000) break;
      }
      setRows(all);
    } catch (e) { setLoadError(e.message || "등록 목록을 불러오지 못했습니다. 다시 조회하세요."); }
    finally { setLoading(false); }
  }, [config]);
  useEffect(() => { refresh(); }, [refresh]);

  async function save(e) {
    e.preventDefault();
    if (busyRef.current) return;
    setError(""); setSuccess("");
    if (!code.trim() || !name.trim()) { setError("코드와 이름을 모두 입력하세요."); return; }
    busyRef.current = true; setBusy(true);
    try {
      if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.");
      const { error } = await supabase.rpc("create_production_master", { p_kind: kind, p_code: code.trim(), p_name: name.trim() });
      if (error) throw error;
      setSuccess(`${config.title} '${name.trim()}' 등록이 완료되었습니다. 작업지시 등록 시 선택할 수 있습니다.`);
      setCode(""); setName("");
      await refresh();
    } catch (e) {
      setError(e.code === "23505" ? "이미 등록된 코드입니다. 목록에서 확인하거나 다른 코드를 입력하세요."
        : e.code === "42501" || e.message?.includes("관리자 권한") ? "등록 권한 설정이 필요합니다. 관리자에게 요청하세요."
        : e.message?.includes("create_production_master") || e.message?.includes("schema cache") ? "기초정보 등록을 위한 DB 설정이 필요합니다. 관리자에게 요청하세요."
        : e.message || "등록하지 못했습니다. 연결 상태를 확인하세요.");
    } finally { busyRef.current = false; setBusy(false); }
  }
  const filtered = rows.filter(row => `${row[config.code]} ${row[config.name]}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <main className="shell">
    <header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><Factory size={20}/></span><span>FOUNDRY<span className="brand-sub"> 공정 관리</span></span></Link><AppNav/></header>
    <div className="content">
      <div className="eyebrow">MASTER DATA</div>
      <section className="intro"><div><h1>{config.title} 등록</h1><p>작업지시에 사용할 {config.title} 정보를 등록하고 조회합니다.</p></div><Link className="secondary-btn" href="/orders/">작업지시 관리로</Link></section>
      <section className="registry-card" aria-labelledby="registry-form-title">
        <h2 id="registry-form-title">새 {config.title} 등록</h2>
        <form onSubmit={save}>
          <fieldset disabled={busy || !supabase} className="form-grid registry-fields">
            <label>{config.title} 코드 <em>*</em><input required value={code} onChange={e => setCode(e.target.value)} placeholder={config.example}/></label>
            <label>{config.title}명 <em>*</em><input required value={name} onChange={e => setName(e.target.value)} placeholder={`${config.title} 이름을 입력하세요`}/></label>
          </fieldset>
          {kind === "material" && <p className="registry-hint">원재료 투입 단위는 kg입니다. 실제 투입량은 작업지시에서 입력합니다.</p>}
          {error && <div className="alert" role="alert">{error}</div>}
          {success && <p className="scan-result success" role="status">{success}</p>}
          <button className="primary-btn" disabled={busy || !supabase}>{busy ? "등록 중…" : `${config.title} 등록`}</button>
        </form>
      </section>
      <section className="board registry-list" aria-labelledby="registry-list-title">
        <div className="board-heading"><div><h2 id="registry-list-title">등록된 {config.title} <span>{filtered.length}</span></h2><p>코드와 이름으로 검색할 수 있습니다.</p></div><div className="board-actions"><div className="search"><Search size={18}/><input aria-label={`${config.title} 검색`} value={query} onChange={e => setQuery(e.target.value)} placeholder="코드 또는 이름 검색"/></div><button type="button" className="icon-btn" onClick={refresh} disabled={loading || busy} aria-label="목록 새로고침"><RefreshCw size={18}/></button></div></div>
        {loadError && <div className="alert" role="alert">{loadError}</div>}
        {loading ? <div className="empty">목록을 불러오는 중입니다.</div> : loadError ? <div className="empty">목록을 확인할 수 없습니다. 새로고침해 주세요.</div> : filtered.length ? <table className="registry-table"><thead><tr><th scope="col">{config.title} 코드</th><th scope="col">{config.title}명</th></tr></thead><tbody>{filtered.map(row => <tr key={row[config.code]}><td>{row[config.code]}</td><td>{row[config.name]}</td></tr>)}</tbody></table> : <div className="empty">{query.trim() ? "검색 결과가 없습니다." : `등록된 ${config.title} 정보가 없습니다. 위에서 먼저 등록하세요.`}</div>}
      </section>
    </div>
  </main>;
}
