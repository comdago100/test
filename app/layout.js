import "./globals.css";
import DeploymentNotice from "./DeploymentNotice";

export const metadata = {
  title: "주조 공정 관리",
  description: "현장과 사무실을 연결하는 생산 현황",
};

export default function RootLayout({ children }) {
  return <html lang="ko"><body><DeploymentNotice/>{children}</body></html>;
}