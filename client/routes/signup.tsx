import { createFileRoute } from "@tanstack/react-router";
import PageLayout from "../layout/PageLayout/PageLayout";
import { SignInButton, SignUp, SignUpButton } from "@clerk/clerk-react";
import Container from "../primitives/Container/Container";
import Box from "../primitives/Box/Box";
import Button from "../primitives/Button/Button";
import { Text } from "../primitives/Text/Text";
import { Group } from "../primitives/Group/Group";

export const Route = createFileRoute("/signup")({
  component: Signup,
  staticData: { layout: { hideNav: true } },
});

function Signup() {
  return (
    <PageLayout>
      <Container size="xs">
        <Box py="6xl">
          <Box pb="4xl">
            <Text size="xl" weight="bold" align="center" mb="lg">
              Welcome to Ortus
            </Text>
          </Box>
          <Group direction="row" align="center" justify="center" spacing="md">
            <SignUpButton>
              <Button size="lg">Sign up</Button>
            </SignUpButton>
            <SignInButton>
              <Button variant="secondary" size="lg" style={{ marginTop: 16 }}>
                Sign in
              </Button>
            </SignInButton>
          </Group>
        </Box>
      </Container>
    </PageLayout>
  );
}
