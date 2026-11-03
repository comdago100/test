"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const menus = [
  ["/", "생산 현황"],
  ["/sales/", "수주 관리"],
  ["/orders/", "작업지시 관리"],
  ["/scanner/", "현장 스캔"],
  ["/inspections/", "검사성적서"],
  ["/routings/", "라우팅·공정"],
  ["/purchases/", "구매·입고"],
  ["/inventory/", "재고 현황"],
  ["/masters/", "기초정보"],
];

export default function AppNav() {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  return <nav className="nav" aria-label="주 메뉴">{menus.map(([href, label]) => {
    const active = pathname === (href.replace(/\/$/, "") || "/") || href==='/masters/'&&['/items','/clients','/materials'].includes(pathname);
    return <Link key={href} href={href} className={active ? "nav-current" : ""} aria-current={active ? "page" : undefined}>{label}</Link>;
  })}</nav>;
}
