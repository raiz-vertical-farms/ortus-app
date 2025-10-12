import {
  createRootRoute,
  Link,
  Outlet,
  useMatches,
} from "@tanstack/react-router";
import { StaticDataRouteOption } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useCheckJWT } from "../hooks/useCheckJwt";
import Container from "../primitives/Container/Container";
import { Group } from "../primitives/Group/Group";
import { PlantIcon, UserCircleIcon } from "@phosphor-icons/react";
import { Text } from "../primitives/Text/Text";
import React from "react";
import Box from "../primitives/Box/Box";

const NAV_HEIGHT = 100;
const HEADER_HEIGHT = 100;

function NavBar() {
  return (
    <div
      style={{
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <Container>
        <Group
          align="center"
          justify="center"
          spacing="3xl"
          style={{
            height: NAV_HEIGHT,
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <Link to="/" viewTransition={{ types: ["slide-right"] }}>
            {({ isActive }) => (
              <PlantIcon
                color={isActive ? "var(--color-primary)" : "currentColor"}
                size={32}
              />
            )}
          </Link>
          <Link to="/account" viewTransition={{ types: ["slide-left"] }}>
            {({ isActive }) => (
              <UserCircleIcon
                color={isActive ? "var(--color-primary)" : "currentColor"}
                size={32}
              />
            )}
          </Link>
        </Group>
      </Container>
    </div>
  );
}

function RootLayout() {
  useCheckJWT();

  const match = useMatches({});

  const getLayout = (m: any) => m.context?.layout ?? m.staticData?.layout;

  const layout = match.reduce(
    (acc, m) => {
      return { ...acc, ...getLayout(m) };
    },
    {} as StaticDataRouteOption["layout"]
  );

  const { hideNav } = layout || {};

  const mainHeight = hideNav ? "100dvh" : `calc(100dvh - ${NAV_HEIGHT}px)`;

  return (
    <ErrorBoundary>
      <div
        style={{
          width: "100%",
          viewTransitionName: "main-content",
          height: mainHeight,
          overflow: "auto",
        }}
      >
        <Outlet />
      </div>
      {!hideNav && <NavBar />}
      <TanStackRouterDevtools />
    </ErrorBoundary>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    // You can also log the error to an error reporting service
    console.error(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <Box pt="7xl">
          <Text align="center">Something went wrong.</Text>
        </Box>
      );
    }

    return <div>{this.props.children}</div>;
  }
}

export const Route = createRootRoute({ component: RootLayout });
