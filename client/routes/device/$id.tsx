import { createFileRoute, useParams } from "@tanstack/react-router";
import { apiClient } from "../../lib/hono-client";
import Container from "../../primitives/Container/Container";
import { useQuery } from "../../hooks";
import { Text } from "../../primitives/Text/Text";
import Box from "../../primitives/Box/Box";

export const Route = createFileRoute("/device/$id")({
  component: RouteComponent,
  loader: async ({ params }) => {
    console.log("Loader for /device/$id", params);
    return apiClient.device[":id"].state.$get({ param: { id: params.id } });
  },
});

function RouteComponent() {
  const { id } = Route.useParams();

  const { data } = useQuery(apiClient.device[":id"].state.$get, {
    param: { id },
  });

  if (!data) {
    return <Container>Loading...</Container>;
  }

  if (!data.success) {
    return <Container>{data.error}</Container>;
  }

  return (
    <Container>
      <Box pt="10">
        <Text size="xl"> {data.state.name}</Text>
      </Box>
    </Container>
  );
}
