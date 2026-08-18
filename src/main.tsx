import ReactDOM from "react-dom/client";
import App from "./App";
import TemporaryWorkspaceNavigation from "./TemporaryWorkspaceNavigation";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <>
    <TemporaryWorkspaceNavigation />
    <App />
  </>
);
