// ESLint flat config — scoping the React 19 RC "compiler" hook rules to warnings.
//
// The build (CRACO, see craco.config.js) only enforces `rules-of-hooks` (error)
// and `exhaustive-deps` (warn). The standalone lint tooling additionally pulls in
// `react-hooks/set-state-in-effect` and `react-hooks/purity` (React Compiler RC
// rules). Those flag the standard "fetch-in-useEffect → setState" and
// "WebSocket onmessage → setState" patterns that this CRA codebase uses in nearly
// every page. They are not appropriate as hard errors here, so we downgrade them.
module.exports = [
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
];
