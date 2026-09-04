import { useMemo } from "react";
import { CompanyEntitlements, EntitlementPlanId, getEntitlementPlan } from "../../companyEntitlements";
import { formatPlanPkr, quotePlanRate } from "../../planRateCalculator";

type Props = {
  planId: EntitlementPlanId;
  limits: CompanyEntitlements["limits"];
};

export default function MasterPlanRateBox({ planId, limits }: Props) {
  const plan = getEntitlementPlan(planId);
  const quote = useMemo(() => quotePlanRate(limits, planId), [limits, planId]);
  const isCustom = planId === "custom";
  const headline = isCustom ? quote.calculatedPkr : (quote.officialPkr ?? quote.calculatedPkr);

  return (
    <div className="master-rate-box" aria-label="Plan rate">
      <h4 className="master-detail-subhead">{isCustom ? "Rate calculator" : "Rate"}</h4>
      <p className="muted" style={{ marginTop: 0 }}>
        {isCustom
          ? "Suggested 3-month quote from the limits above, using Pro and Enterprise as the rate anchors."
          : "Plan rate for this tier. The check line recalculates from the limits above so you can compare."}
      </p>

      <div className="master-rate-box-head">
        <div>
          <small>{isCustom ? "Suggested quote" : "Plan rate"}</small>
          <b className="master-rate-amount">
            {formatPlanPkr(headline)} / {quote.periodMonths} months
          </b>
        </div>
        <div>
          <small>{isCustom ? "Anchors" : "From current limits"}</small>
          <b>
            {isCustom
              ? `${formatPlanPkr(quote.proPricePkr)} Pro · ${formatPlanPkr(quote.enterprisePricePkr)} Enterprise`
              : `${formatPlanPkr(quote.calculatedPkr)} / ${quote.periodMonths} months`}
          </b>
        </div>
      </div>

      {plan?.trialDays ? (
        <p className="muted">After the {plan.trialDays}-day trial, this is the 3-month rate.</p>
      ) : null}

      <p className="muted master-rate-formula">
        Each limit scores 0 at Pro and 1 at Enterprise. Price is {formatPlanPkr(quote.proPricePkr)} + score ×{" "}
        {formatPlanPkr(quote.enterprisePricePkr - quote.proPricePkr)}. Blank (unlimited) scores 2.
      </p>

      <div className="master-rate-table-wrap">
        <table>
          <caption className="sr-only">Capacity versus Pro and Enterprise rates</caption>
          <thead>
            <tr>
              <th scope="col">Limit</th>
              <th scope="col">This</th>
              <th scope="col">Pro</th>
              <th scope="col">Enterprise</th>
              <th scope="col">Check</th>
            </tr>
          </thead>
          <tbody>
            {quote.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td>{row.value == null ? "Unlimited" : row.value.toLocaleString("en-US")}</td>
                <td>{row.pro.toLocaleString("en-US")}</td>
                <td>{row.enterprise.toLocaleString("en-US")}</td>
                <td>{row.position}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
