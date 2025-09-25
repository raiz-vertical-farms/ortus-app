import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useCheckJWT } from "../hooks/useCheckJwt";
import Container from "../primitives/Container/Container";
import { Group } from "../primitives/Group/Group";
import { HouseSimpleIcon, UserCircleIcon } from "@phosphor-icons/react";

function NavBar() {
  return (
    <Container>
      <Group align="center" justify="between" style={{ height: 60 }}>
        <Link to="/">
          <HouseSimpleIcon size={32} />
        </Link>
        <Link to="/account">
          <UserCircleIcon size={32} />
        </Link>
      </Group>
    </Container>
  );
}

function RootLayout() {
  const isvalid = useCheckJWT();

  return (
    <div>
      {isvalid && <NavBar />}
      <Outlet />
      <TanStackRouterDevtools />
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
