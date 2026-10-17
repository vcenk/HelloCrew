// Cost maths in integer micro-USD so budgets never drift with floats.
export function costMicroUsd(
  inputTokens: number,
  outputTokens: number,
  inputUsdPerMTok: number,
  outputUsdPerMTok: number,
): number {
  const micro =
    Math.max(0, inputTokens) * inputUsdPerMTok +
    Math.max(0, outputTokens) * outputUsdPerMTok;
  return Math.ceil(micro);
}

// Upper bound for one agent turn: every model round may re-read the full
// prompt and produce the maximum output.
export function worstCaseMicroUsd(options: {
  promptChars: number;
  rounds: number;
  maxOutputTokens: number;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}): number {
  const promptTokens = Math.ceil(options.promptChars / 3) + 600;
  let total = 0;
  for (let round = 0; round < options.rounds; round++) {
    // Later rounds also carry earlier outputs and tool results.
    const input = promptTokens + round * (options.maxOutputTokens + 1500);
    total += costMicroUsd(
      input,
      options.maxOutputTokens,
      options.inputUsdPerMTok,
      options.outputUsdPerMTok,
    );
  }
  return total;
}
