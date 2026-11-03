"use client";
import {useEffect,useState} from "react";
export function usePagination(rows,resetKey="",key="default"){
 const [size,setSize]=useState(10),[page,setPage]=useState(1);
 useEffect(()=>{try{const n=Number(localStorage.getItem(`foundry.pageSize.${key}`));if([5,10,20,50].includes(n))setSize(n);}catch{}},[key]);
 useEffect(()=>setPage(1),[resetKey]);
 const pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,pages);
 useEffect(()=>setPage(p=>Math.min(p,pages)),[pages]);
 function resize(n){setSize(n);setPage(1);try{localStorage.setItem(`foundry.pageSize.${key}`,String(n));}catch{}}
 return {size,page:current,pages,total:rows.length,rows:rows.slice((current-1)*size,current*size),resize,go:n=>{if(Number.isFinite(n))setPage(Math.max(1,Math.min(pages,Math.trunc(n))));}};
}
export default function Pagination({pager,compact=false}){
 const {page,pages,total,size}=pager;
 return <div className="pagination" role="navigation" aria-label={compact?"하단 페이지 탐색":"목록 페이지 탐색"}>
  {!compact&&<label>보기 수<select aria-label="페이지당 표시 수" value={size} onChange={e=>pager.resize(Number(e.target.value))}>{[5,10,20,50].map(n=><option key={n} value={n}>{n}개씩 보기</option>)}</select></label>}
  <span>총 {total.toLocaleString()}건 · {total?(page-1)*size+1:0}–{Math.min(page*size,total)}건</span>
  <div><button type="button" disabled={page<=1} onClick={()=>pager.go(1)}>처음</button><button type="button" disabled={page<=1} onClick={()=>pager.go(page-1)}>이전</button><label><span className="sr-only">페이지 이동</span><input aria-label={compact?"하단 페이지 이동":"페이지 이동"} type="number" min="1" max={pages} value={page} onChange={e=>{if(e.target.value)pager.go(Number(e.target.value));}}/> / {pages}</label><button type="button" disabled={page>=pages} onClick={()=>pager.go(page+1)}>다음</button><button type="button" disabled={page>=pages} onClick={()=>pager.go(pages)}>마지막</button></div>
 </div>;
}
