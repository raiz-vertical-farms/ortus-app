import { createFileRoute } from "@tanstack/react-router";
import { getErrorMessage } from "../../utils/error";
import { Text } from "../../primitives/Text/Text";
import Box from "../../primitives/Box/Box";
import { client } from "../../lib/apiClient";

export const Route = createFileRoute("/device/$id")({
  component: RouteComponent,
});

function RouteComponent() {
  const { id } = Route.useParams();

  const { data, error, isLoading } = client.api.deviceState.useQuery({
    path: { id },
  });

  if (isLoading || !data) {
    return "Loading...";
  }

  if (error) {
    return getErrorMessage(error);
  }

  return (
    <Box pt="10">
      <Text size="xl"> {data.state.name}</Text>
    </Box>
  );
}
