import { useEffect, useState } from "react";
import { ModalPortal } from "./ModalPortal";
import { CAPACITY_LIMIT_EVENT } from "./companyEntitlements";
import { COMPANY_SUSPENDED_EVENT } from "./companyStatus";

type CapacityLimitDetail = {
  title?: string;
  message?: string;
};

export default function CapacityLimitDialog() {
  const [title, setTitle] = useState("Limit exceeded");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const onNotice = (event: Event) => {
      const detail = (event as CustomEvent<CapacityLimitDetail>).detail;
      const text = String(detail?.message || "").trim();
      if (!text) return;
      setTitle(String(detail?.title || "Limit exceeded"));
      setMessage(text);
    };
    window.addEventListener(CAPACITY_LIMIT_EVENT, onNotice);
    window.addEventListener(COMPANY_SUSPENDED_EVENT, onNotice);
    return () => {
      window.removeEventListener(CAPACITY_LIMIT_EVENT, onNotice);
      window.removeEventListener(COMPANY_SUSPENDED_EVENT, onNotice);
    };
  }, []);

  if (!message) return null;

  return (
    <ModalPortal>
      <div className="capacity-limit-backdrop" role="presentation" onClick={() => setMessage("")}>
        <div
          className="capacity-limit-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="capacity-limit-title"
          onClick={(event) => event.stopPropagation()}
        >
          <h3 id="capacity-limit-title">{title}</h3>
          <p>{message}</p>
          <div className="capacity-limit-actions">
            <button type="button" className="primary" onClick={() => setMessage("")}>
              OK
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
