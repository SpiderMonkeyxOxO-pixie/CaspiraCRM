import { Outlet } from "react-router-dom";
import DemoNotice from "../../components/DemoNotice";

export default function MarketingLayout() {
  return (
    <div>
      <DemoNotice module="Marketing" />
      <Outlet />
    </div>
  );
}
