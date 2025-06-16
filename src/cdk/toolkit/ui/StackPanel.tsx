import React, { useState } from 'react'
import { Box, Text, useInput, useFocus } from 'ink'

export interface StackPanelProps {
  stack_name: string
  status: string
  logs: string[]
  is_initially_expanded?: boolean
}

export const StackPanel: React.FC<StackPanelProps> = ({
  stack_name,
  status,
  logs,
  is_initially_expanded = false,
}) => {
  const [is_expanded, set_is_expanded] = useState<boolean>(is_initially_expanded)
  const { isFocused } = useFocus()

  useInput(
    (input, key) => {
      if (isFocused && key.return) {
        set_is_expanded(!is_expanded)
      } else if (input === 'r' && key.ctrl) {
        // Ctrl+r will toggle the focused panel
        set_is_expanded(!is_expanded)
      }
    },
    { isActive: isFocused } // Only handle input if this specific panel is focused
  )

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      paddingX={1}
      marginBottom={1}
      borderColor={isFocused ? 'blue' : 'gray'} // Highlight when focused
    >
      <Text bold>{`${is_expanded ? '▼' : '▶'} ${stack_name}`}</Text>
      <Box flexDirection="column" paddingLeft={1}>
        <Text>{(status && status.trim()) || ''}</Text>
        {is_expanded && (
          <Box flexDirection="column" marginTop={1} paddingLeft={2}>
            {logs.map((log_line, index) => (
              <Text key={index}>{log_line}</Text>
            ))}
            {logs.length === 0 && <Text italic>No logs yet...</Text>}
          </Box>
        )}
      </Box>
    </Box>
  )
}
