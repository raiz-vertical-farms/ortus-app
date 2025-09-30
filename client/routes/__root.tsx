import {
  createRootRoute,
  Link,
  Outlet,
  useMatches,
  useRouter,
} from "@tanstack/react-router";
import { StaticDataRouteOption } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useCheckJWT } from "../hooks/useCheckJwt";
import Container from "../primitives/Container/Container";
import { Group } from "../primitives/Group/Group";
import {
  ArrowLeftIcon,
  PlantIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Text } from "../primitives/Text/Text";

const NAV_HEIGHT = 80;
const HEADER_HEIGHT = 60;

function NavBar() {
  return (
    <div style={{ borderTop: "1px solid #e5e7eb" }}>
      <Container>
        <Group
          align="center"
          justify="center"
          spacing="3xl"
          style={{ height: NAV_HEIGHT }}
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

  const layout = match.reduce(
    (acc, m) => {
      return { ...acc, ...getLayout(m) };
    },
    {} as StaticDataRouteOption["layout"]
  );

  const {
    pageTitle,
    hideNav,
    leftSection,
    rightSection,
    middleSection,
    backButton,
    closeButton,
  } = layout || {};

  const left = leftSection ? (
    typeof leftSection === "function" ? (
      leftSection()
    ) : (
      leftSection
    )
  ) : backButton ? (
    <Link to="/" viewTransition={{ types: ["slide-right"] }}>
      <ArrowLeftIcon size={24} />
    </Link>
  ) : null;

  const middle = middleSection ? (
    typeof middleSection === "function" ? (
      middleSection()
    ) : (
      middleSection
    )
  ) : (
    <Text size="lg">{pageTitle ? pageTitle : ""}</Text>
  );

  const right = rightSection ? (
    typeof rightSection === "function" ? (
      rightSection()
    ) : (
      rightSection
    )
  ) : closeButton ? (
    <XIcon
      size={24}
      onClick={() =>
        router.navigate({
          to: "/",
          viewTransition: { types: ["slide-down"] },
        })
      }
    />
  ) : null;

  const showHeader =
    pageTitle ||
    backButton ||
    closeButton ||
    leftSection ||
    middleSection ||
    rightSection;

  const mainHeight =
    showHeader && !hideNav
      ? `calc(100dvh - ${NAV_HEIGHT + HEADER_HEIGHT}px)`
      : showHeader || !hideNav
        ? `calc(100dvh - ${NAV_HEIGHT}px)`
        : "100dvh";

  return (
    <div>
      {showHeader && (
        <header
          style={{
            height: HEADER_HEIGHT,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Container>
            <Group justify="between" align="center">
              <div style={{ width: "30%", textAlign: "left" }}>{left}</div>
              <div style={{ flex: 1, width: "100%", textAlign: "center" }}>
                {middle}
              </div>
              <div style={{ width: "30%", textAlign: "right" }}>{right}</div>
            </Group>
          </Container>
        </header>
      )}
      <Container
        style={{
          viewTransitionName: "main-content",
          height: mainHeight,
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
