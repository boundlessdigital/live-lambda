import React from 'react'
import { Box, Text } from 'ink'

export const ShortcutMenu: React.FC = () => {
  return (
    <Box borderStyle="single" borderTop={true} borderTopColor="gray" paddingTop={1} paddingX={1} marginTop={1}><Text dimColor><Text bold color="cyan">Tab</Text>: Navigate Panels | <Text bold color="cyan">Enter</Text>: Toggle Expand (focused panel) | <Text bold color="cyan">Ctrl+R</Text>: Toggle Expand (focused panel)</Text></Box>
  )
}
