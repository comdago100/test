"use client";
import { useEffect, useState } from "react";
export default function DeploymentNotice() {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (location.hostname.endsWith(".test-ict.pages.dev")) setUrl("https://test-ict.pages.dev" + location.pathname);
  }, []);
  return url ? <div className="deployment-notice">현재 특정 배포 버전을 보고 있습니다.<a href={url}>최신 운영 화면 열기</a></div> : null;
}