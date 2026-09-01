import { useSessionStore } from './store/useSessionStore'

export { useSessionStore }
export function useRivetSession() {
  return useSessionStore()
}
