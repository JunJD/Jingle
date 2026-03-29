# AGENT Rules

- React: do not call `setState` synchronously inside `useEffect` just to mirror props or derived UI state.
- Prefer derived values during render, or a controlled/uncontrolled state split such as `const open = forcedOpen || manualOpen`.
- This is specifically disallowed for patterns like `if (approvalRequest) setIsExpanded(true)` inside an effect because it causes cascading renders.
