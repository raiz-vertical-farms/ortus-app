import {
  createRootRoute,
  Link,
  Outlet,
  useMatches,
  useRouter,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useCheckJWT } from "../hooks/useCheckJwt";
import Container from "../primitives/Container/Container";
import { Group } from "../primitives/Group/Group";
import {
  ArrowLeftIcon,
  HouseSimpleIcon,
  PlantIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Text } from "../primitives/Text/Text";

function NavBar() {
  return (
    <div style={{ borderTop: "1px solid #e5e7eb" }}>
      <Container>
        <Group
          align="center"
          justify="center"
          spacing="32"
          style={{ height: 100 }}
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

  const router = useRouter();
  const match = useMatches({});

  const getLayout = (m: any) => m.context?.layout ?? m.staticData?.layout;

  console.log({ match });

  const isCentered = match.some((m) => getLayout(m)?.center);
  const hideNav = match.some((m) => getLayout(m)?.hideNav);
  const backButton = match.some((m) => getLayout(m)?.backButton);
  const closeButton = match.some((m) => getLayout(m)?.closeButton);
  const pageTitle = match.find((m) => getLayout(m)?.pageTitle)
    ? getLayout(match.find((m) => getLayout(m)?.pageTitle)!)?.pageTitle
    : undefined;

  const showHeader = pageTitle || backButton;

  return (
    <div>
      {showHeader && (
        <header
          style={{
            height: 100,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Container>
            <Group justify="between" align="center">
              {backButton ? (
                <Link to="/" viewTransition={{ types: ["slide-right"] }}>
                  <ArrowLeftIcon size={24} />
                </Link>
              ) : (
                <div style={{ width: 24 }} />
              )}
              <Text size="lg">{pageTitle ? pageTitle : ""}</Text>
              {closeButton ? (
                <XIcon
                  size={24}
                  onClick={() =>
                    router.navigate({
                      to: "/",
                      viewTransition: { types: ["slide-down"] },
                    })
                  }
                />
              ) : (
                <div style={{ width: 24 }} />
              )}
            </Group>
          </Container>
        </header>
      )}
      <Container
        style={{
          height: showHeader ? "calc(100dvh - 200px)" : "calc(100dvh - 100px)",
          overflow: "auto",
        }}
      >
        <div style={{ width: "100%" }}>
          <Outlet />
        </div>
      </Container>
      {!hideNav && <NavBar />}
      <TanStackRouterDevtools />
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
