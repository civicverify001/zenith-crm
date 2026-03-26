import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppRouter } from './app/Router'
import { BranchProvider } from './contexts/BranchContext'
import './index.css'
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,       // 30 seconds
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <BranchProvider>
          <AppRouter />
        </BranchProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
