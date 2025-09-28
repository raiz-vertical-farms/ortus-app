export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;

  if (e && typeof e === "object") {
    const anyE = e as any;

    // Handle case with error array
    if (Array.isArray(anyE.error) && anyE.error.length > 0) {
      return anyE.error[0].message ?? "An unknown error occurred";
    }

    return (
      anyE.message ??
      anyE.data?.message ??
      anyE.response?.data?.message ??
      "An unknown error occurred"
    );
  }

  return "An unknown error occurred";
}
