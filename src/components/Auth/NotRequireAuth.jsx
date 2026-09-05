import { useSelector } from "react-redux";
import { Navigate, Outlet } from "react-router-dom";
import { getHomePathForRole } from "../../utils/roleRoutes";

const NotRequireAuth = () => {
  const { isLoggedIn, role } = useSelector((state) => state.auth);
  return isLoggedIn ? (
    <Navigate to={getHomePathForRole(role) || "/dashboard"} replace />
  ) : (
    <Outlet />
  );
};

export default NotRequireAuth;
