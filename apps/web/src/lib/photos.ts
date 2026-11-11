import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useSession } from "./session";

/** Which employees have a photo ({ employeeId: version }), loaded once per company. */
export function usePhotos() {
  const { tenant } = useSession();
  return useQuery({
    queryKey: ["photos", tenant?.tenantId],
    queryFn: () => api.get<Record<string, string>>("/photos"),
    // support sessions can't load the images, so they get initials
    enabled: !!tenant && !tenant.support,
    staleTime: 5 * 60_000,
  });
}

export const photoSrc = (employeeId: string, version: string) => `/api/photo/${employeeId}?v=${version}`;
