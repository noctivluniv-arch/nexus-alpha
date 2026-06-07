import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { customFetch } from "../custom-fetch.js";

export interface HealthStatus {
  status: string;
}

export const getHealthCheckQueryKey = () => ["/api/healthz"] as const;

export const healthCheck = (): Promise<HealthStatus> => {
  return customFetch<HealthStatus>("/api/healthz", { method: "GET" });
};

export const useHealthCheck = 
  TData = HealthStatus,
  TError = unknown
>(options?: Omit<UseQueryOptions<HealthStatus, TError, TData>, "queryKey" | "queryFn">) => {
  return useQuery<HealthStatus, TError, TData>({
    queryKey: getHealthCheckQueryKey(),
    queryFn: () => healthCheck(),
    ...options,
  });
};
