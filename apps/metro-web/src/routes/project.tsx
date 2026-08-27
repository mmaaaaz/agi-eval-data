import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/project')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/project"!</div>
}
