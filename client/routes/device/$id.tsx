import { createFileRoute } from "@tanstack/react-router";
import { apiClient } from "../../lib/hono-client";
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
    return "Loading...";
  }

  if (!data.success) {
    return data.error;
  }

  return (
    <Box pt="10">
      <Text size="xl"> {data.state.name}</Text>
    </Box>
  );
}
