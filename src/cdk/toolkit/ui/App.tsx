import React from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { StackPanel, type StackPanelProps } from './StackPanel.js'
import { Footer } from './Footer.js' // Import Footer

export interface AppProps {
  stacks_data: StackPanelProps[]
}

const App: React.FC<AppProps> = ({ stacks_data }) => {
  const { exit } = useApp()

  // Global input handler for Ctrl+C exit
  useInput(
    (input, key) => {
      if (key.ctrl && (input === 'c' || input === 'C')) {
        exit()
      }
    },
    { isActive: true } // Ensure this hook is always active
  )

  const handle_input_submit = (input_value: string): void => {
    // For now, just log it. Actual command handling will come later.
    // You can use this function to process commands entered by the user.
    // Example: if (input_value === 'clear') { /* clear logs */ }
    console.error(`INPUT: ${input_value} (not implemented yet)`) // Using console.error as it was more stable
  }

  return (
    <Box flexDirection="column" height="100%" width="100%">
      <Box flexDirection="column" paddingBottom={1} flexShrink={0}>
        <Text bold color="blue">AWS CDK Deployment Status</Text>
        <Text color="gray" dimColor>(Use Tab to focus, Enter or Ctrl+r to expand/collapse stacks)</Text>
      </Box>
      <Box
        flexGrow={1}
        flexDirection="column"
        overflowY="visible"
        paddingBottom={1}
      >
        {stacks_data.map((stack_prop) => (
          <StackPanel key={stack_prop.stack_name} {...stack_prop} />
        ))}
        {stacks_data.length === 0 && <Text>No stacks deploying currently.</Text>}
      </Box><Box flexShrink={0}><Footer on_submit_input={handle_input_submit} /></Box>
    </Box>
  )
}

export default App
