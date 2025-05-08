// File: /Users/sidney/boundless/live-lambda/tunnel/index.ts

import { inspect } from 'util'

const project_name: string = 'live-lambda-tunnel'

function greet_user(user_name: string): string {
  return `Hello, ${user_name}! Welcome to the ${project_name} package.`
}

const greeting_message: string = greet_user('Developer')
console.log(greeting_message)

const sample_object_data: { id: number; active: boolean; features: string[] } =
  {
    id: 123,
    active: true,
    features: ['esm', 'tsx', 'typescript']
  }

console.log('\n--- Detailed Object Inspection ---')
console.log(inspect(sample_object_data, { depth: null, colors: true }))

export { greet_user }
