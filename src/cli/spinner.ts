import ora from 'ora';

const DEEP_MESSAGES = [
  'Analyzing your instruction files…',
  'Checking rule effectiveness…',
  'Looking for coverage gaps…',
  'Finding consolidation opportunities…',
  'Evaluating rule clarity…',
  'Almost there…',
];

export function createDeepSpinner() {
  const spinner = ora({
    text: DEEP_MESSAGES[0],
    color: 'cyan',
  }).start();

  let idx = 0;
  const interval = setInterval(() => {
    idx = (idx + 1) % DEEP_MESSAGES.length;
    spinner.text = DEEP_MESSAGES[idx];
  }, 3000);

  return {
    stop() {
      clearInterval(interval);
      spinner.stop();
    },
    succeed(text: string) {
      clearInterval(interval);
      spinner.succeed(text);
    },
    fail(text: string) {
      clearInterval(interval);
      spinner.fail(text);
    },
  };
}
