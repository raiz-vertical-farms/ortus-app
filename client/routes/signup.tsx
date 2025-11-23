import { createFileRoute } from "@tanstack/react-router";
import PageLayout from "../layout/PageLayout/PageLayout";
import { SignUp } from "@clerk/clerk-react";
import Container from "../primitives/Container/Container";
import Box from "../primitives/Box/Box";

export const Route = createFileRoute("/signup")({
  component: Signup,
  staticData: { layout: { hideNav: true } },
});

function Signup() {
  return (
    <PageLayout>
      <Container size="xs">
        <Box py="6xl">
          <SignUp />
        </Box>
      </Container>
    </PageLayout>
  );
}
