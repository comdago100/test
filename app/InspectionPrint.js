"use client";
import {productFields,judgementLabels,testGroups} from '../lib/product-details';
export default function InspectionPrint({report,close}){
 const d=report.document,p=d.product||{},fields=productFields.filter(([k])=>k!=='extra');
 return <div className="print-backdrop inspection-print" role="dialog" aria-modal="true" aria-labelledby="inspection-print-title"><section className="print-sheet">
 <div className="print-tools"><button className="primary-btn" onClick={()=>window.print()}>인쇄 / PDF 저장</button><button className="secondary-btn" onClick={close}>미리보기 닫기</button></div>
 <h1 id="inspection-print-title">검사성적서</h1><p className="certificate-subtitle">INSPECTION REPORT</p>
 <div className="certificate-header"><div><h2>{d.manufacturer||'제조사 미입력'}</h2><p>{d.manufacturer_address}</p></div><strong>{report.status==='issued'?'발행본':report.status==='void'?'취소된 성적서 · 사용 불가':'초안 · 미발행'}</strong></div>
 <table className="print-table"><tbody><tr><th>성적서 번호</th><td>{report.report_no}</td><th>문서 버전</th><td>{report.revision}</td></tr><tr><th>작업지시</th><td>{report.wo_id}</td><th>거래처</th><td>{p.client_name||p.client_code}</td></tr><tr><th>검사일</th><td>{d.inspected_on}</td><th>발행일</th><td>{report.status==='issued'||report.issued_at?d.issued_on:'미발행'}</td></tr>
 {fields.filter((_,i)=>i%2===0).map(([k,label],i)=>{const other=fields[i*2+1];return <tr key={k}><th>{label}</th><td>{p[k]||'—'}</td><th>{other?.[1]||''}</th><td>{p[other?.[0]]||'—'}</td></tr>;})}
 <tr><th>용해 번호 / 로트</th><td>{p.heat_no||'—'}</td><th>품목 코드</th><td>{p.item_code}</td></tr><tr><th>대상 로트수량</th><td>{d.lot_qty}개</td><th>실제 검사수량</th><td>{d.inspection_qty}개</td></tr>{p.extra&&<tr><th>기타 제품정보</th><td colSpan="3">{p.extra}</td></tr>}{d.external_ref&&<tr><th>외부 시험기관 / 성적서</th><td colSpan="3">{d.external_ref}</td></tr>}</tbody></table>
 <h2>검사 기준 및 결과</h2><table className="print-table certificate-results"><thead><tr>{['구분 / 항목','기준 / 허용값','방법 / 단위','실측·검사 결과','판정','비고'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{d.tests.map((t,i)=><tr key={i}><td>{testGroups[t.group]}<br/>{t.name||'미입력'}</td><td>{t.standard||'미입력'}</td><td>{t.method||'—'}<br/>{t.unit}</td><td>{t.result||'미입력'}</td><td>{judgementLabels[t.judgement]}</td><td>{t.remark}</td></tr>)}</tbody></table>
 <table className="print-table certificate-signoff"><tbody><tr><th>종합 판정</th><td>{report.status==='issued'?judgementLabels[report.judgement]:report.status==='void'?'취소':'미발행'}</td><th>검사자 / 확인자</th><td>{d.inspector||'—'} / {d.reviewer||'—'}</td></tr><tr><th>특기사항</th><td colSpan="3">{d.remarks||'—'}</td></tr>{report.void_reason&&<tr><th>취소 사유</th><td colSpan="3">{report.void_reason}</td></tr>}</tbody></table>
 <p className="print-footer">기재한 제품·로트와 검사수량의 자체 검사 결과입니다. 요구 선급 표기는 선급 승인을 의미하지 않으며, 별도의 승인·인증 성적서를 대체하지 않습니다.</p>
 </section></div>;
}
