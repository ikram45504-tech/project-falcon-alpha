import { useEffect, useState } from "react";
import { ModalPortal } from "./ModalPortal";
import { CAPACITY_LIMIT_EVENT } from "./companyEntitlements";

type CapacityLimitDetail = {
  title?: string;
  message?: string;
};

export default function CapacityLimitDialog() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    const onLimit = (event: Event) => {
      const detail = (event as CustomEvent<CapacityLimitDetail>).detail;
      const text = String(detail?.message || "").trim();
      if (text) setMessage(text);
    };
    window.addEventListener(CAPACITY_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(CAPACITY_LIMIT_EVENT, onLimit);
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
          <h3 id="capacity-limit-title">Limit exceeded</h3>
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
