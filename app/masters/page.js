import Link from 'next/link';
import {Factory} from 'lucide-react';
import AppNav from '../AppNav';

export default function Masters(){
 return <main className="shell"><header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><Factory size={20}/></span>FOUNDRY<span className="brand-sub">공정 관리</span></Link><AppNav/></header><div className="content"><div className="eyebrow">MASTER DATA</div><section className="intro"><div><h1>기초정보</h1><p>수주와 구매에 사용할 제품·거래처·원재료를 등록합니다.</p></div></section><div className="master-cards">{[
 ['/items/','제품 등록','제품 코드·품명·사이즈·재질·규격 등 기본 사양을 관리합니다. PO와 주문 수량은 수주에서 입력합니다.'],
 ['/clients/','거래처 등록','매출처·매입처 구분과 담당자·연락처·사업자 정보를 관리합니다.'],
 ['/materials/','원재료 등록','kg 단위 원재료의 코드와 이름을 관리합니다. 실제 입고는 구매·입고에서 기록합니다.'],
 ].map(([href,title,description])=><Link className="erp-card master-card" href={href} key={href}><h2>{title}</h2><p>{description}</p><strong>등록 / 관리 →</strong></Link>)}</div><div className="erp-card"><h2>업무 시작</h2><p>기초정보 등록 후 고객 주문은 수주 관리에서, 원재료 입고는 구매·입고에서 시작하세요.</p><div className="erp-actions"><Link href="/sales/" className="primary-btn">수주 관리</Link><Link href="/purchases/" className="secondary-btn">구매·입고</Link></div></div></div></main>;
}
