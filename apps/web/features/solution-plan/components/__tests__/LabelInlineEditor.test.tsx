import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  LabelInlineEditor,
  LABEL_SAVE_FAILED_MESSAGE,
  LABEL_TOO_LONG_MESSAGE,
} from '../LabelInlineEditor';

const setup = ({
  initialValue = '',
  onSave = jest.fn().mockResolvedValue({ outcome: 'saved' }),
  onDone = jest.fn(),
} = {}) => {
  render(<LabelInlineEditor initialValue={initialValue} onSave={onSave} onDone={onDone} />);
  return { onSave, onDone, input: screen.getByTestId('version-label-input') as HTMLInputElement };
};

describe('LabelInlineEditor', () => {
  it('prefills the input with the current label', () => {
    const { input } = setup({ initialValue: 'Final review' });
    expect(input.value).toBe('Final review');
  });

  it('saves the trimmed value on Enter and closes on success', async () => {
    const { onSave, onDone, input } = setup();

    fireEvent.change(input, { target: { value: '  Compliance pass  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith('Compliance pass');
  });

  it('submits an empty value as a clear operation', async () => {
    const { onSave, onDone, input } = setup({ initialValue: 'Old label' });

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith('');
  });

  it('cancels on Escape without saving', () => {
    const { onSave, onDone, input } = setup({ initialValue: 'Keep me' });

    fireEvent.change(input, { target: { value: 'Changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onDone).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('cancels on blur without saving', async () => {
    const { onSave, onDone, input } = setup();

    // The editor takes focus one tick after mount (Radix menu focus race).
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: 'Changed' } });
    fireEvent.blur(input);

    expect(onDone).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('ignores the stray blur fired by a closing menu before the editor has focus', () => {
    const { onDone, input } = setup();

    fireEvent.blur(input);

    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows the inline validation message for >100 characters and never calls the API', async () => {
    const { onSave, onDone, input } = setup();

    fireEvent.change(input, { target: { value: 'x'.repeat(101) } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByTestId('version-label-error')).toHaveTextContent(
      LABEL_TOO_LONG_MESSAGE,
    );
    expect(onSave).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(input.value).toBe('x'.repeat(101));
  });

  it('shows the SAME validation message when the server rejects the length', async () => {
    const onSave = jest.fn().mockResolvedValue({ outcome: 'validation' });
    const { input } = setup({ onSave });

    fireEvent.change(input, { target: { value: 'Slipped past' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByTestId('version-label-error')).toHaveTextContent(
      LABEL_TOO_LONG_MESSAGE,
    );
  });

  it('keeps the typed value with a retry hint on save failure', async () => {
    const onSave = jest.fn().mockResolvedValue({ outcome: 'error' });
    const { onDone, input } = setup({ onSave });

    fireEvent.change(input, { target: { value: 'Keep this text' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByTestId('version-label-error')).toHaveTextContent(
      LABEL_SAVE_FAILED_MESSAGE,
    );
    expect(input.value).toBe('Keep this text');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('closes when the version vanished (not-found handled by the hook)', async () => {
    const onSave = jest.fn().mockResolvedValue({ outcome: 'not-found' });
    const { onDone, input } = setup({ onSave });

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
