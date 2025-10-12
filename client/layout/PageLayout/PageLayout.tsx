import { Link, Outlet, useRouter } from "@tanstack/react-router";
import { StaticDataRouteOption } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import Container from "../../primitives/Container/Container";
import { Group } from "../../primitives/Group/Group";
import { ArrowLeftIcon, XIcon } from "@phosphor-icons/react";
import { Text } from "../../primitives/Text/Text";
import Button from "../../primitives/Button/Button";

const NAV_HEIGHT = 100;
const HEADER_HEIGHT = 100;

export default function PageLayout({
  children,
  layout,
}: {
  children: React.ReactNode;
  layout?: StaticDataRouteOption["layout"];
}) {
  const router = useRouter();

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
    <Text size="lg" weight="bold">
      {pageTitle ? pageTitle : ""}
    </Text>
  );

  const right = rightSection ? (
    typeof rightSection === "function" ? (
      rightSection()
    ) : (
      rightSection
    )
  ) : closeButton ? (
    <Button square variant="ghost">
      <XIcon
        size={24}
        onClick={() =>
          router.navigate({
            to: "/",
            viewTransition: { types: ["pop-down"] },
          })
        }
      />
    </Button>
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
    <>
      {showHeader && (
        <header
          style={{
            height: HEADER_HEIGHT,
            display: "flex",
            alignItems: "center",
            paddingTop: "env(safe-area-inset-top)",
          }}
        >
          <Container>
            <Group justify="between" align="center">
              <div style={{ width: "15%", textAlign: "left" }}>{left}</div>
              <div style={{ flex: 1, width: "100%", textAlign: "center" }}>
                {middle}
              </div>
              <div style={{ width: "15%", textAlign: "right" }}>{right}</div>
            </Group>
          </Container>
        </header>
      )}
      <Container style={{ height: `calc(100% - ${HEADER_HEIGHT}px)` }}>
        {children}
      </Container>
      <TanStackRouterDevtools />
    </>
  );
}
