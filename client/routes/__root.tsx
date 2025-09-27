import {
  createRootRoute,
  Link,
  Outlet,
  useMatch,
  useMatches,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useCheckJWT } from "../hooks/useCheckJwt";
import Container from "../primitives/Container/Container";
import { Group } from "../primitives/Group/Group";
import { HouseSimpleIcon, UserCircleIcon } from "@phosphor-icons/react";

function NavBar() {
  return (
    <Container>
      <Group align="center" justify="between" style={{ height: 100 }}>
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

  const match = useMatches({});

  const isCentered = match.some((m) => m.staticData?.layout?.center);

  return (
    <div>
      {isvalid && <NavBar />}
      <Container
        style={{
          minHeight: "calc(100dvh - 100px)",
          display: "grid",
          placeItems: isCentered ? "center" : "unset",
        }}
      >
        <Outlet />
      </Container>
      <TanStackRouterDevtools />
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
