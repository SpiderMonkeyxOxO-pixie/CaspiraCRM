
import React, { useState } from 'react';
import dayjs from 'dayjs';
import Button from '@mui/material/Button';
import CalendarTodayRoundedIcon from '@mui/icons-material/CalendarTodayRounded';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import {
  useParsedFormat,
  usePickerContext,
  useSplitFieldProps,
} from '@mui/x-date-pickers';
import { useForkRef } from '@mui/material/utils';

function ButtonField(props) {
  const { forwardedProps: rawForwardedProps } = useSplitFieldProps(props, 'date');
  const { slotProps: _slotProps, inputRef: _inputRef, ...forwardedProps } = rawForwardedProps;
  const pickerContext = usePickerContext();
  const handleRef = useForkRef(pickerContext.triggerRef, pickerContext.rootRef);
  const parsedFormat = useParsedFormat();

  const valueStr =
    pickerContext.value == null
      ? parsedFormat
      : pickerContext.value.format(pickerContext.fieldFormat);

  return (
    <Button
      {...forwardedProps}
      ref={handleRef}
      variant="outlined"
      size="small"
      startIcon={<CalendarTodayRoundedIcon fontSize="small" />}
      onClick={() => pickerContext.setOpen((prev) => !prev)}
      sx={{
        color: 'white',
        textTransform: 'none',
        padding: '5px 10px',
        fontSize: '0.875rem',
        minWidth: 'fit-content',
        border: 'none',
     
      }}
    >
      {pickerContext.label ?? valueStr}
    </Button>
  );
}

export default function CustomDatePicker() {
  const [value, setValue] = useState(dayjs());

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <DatePicker
        value={value}
        onChange={(newValue) => setValue(newValue)}
        label={value == null ? null : value.format('MMM DD, YYYY')}
        slots={{ field: ButtonField }}
        slotProps={{
          nextIconButton: { size: 'small' },
          previousIconButton: { size: 'small' },
        }}
        views={['day', 'month', 'year']}
      />
    </LocalizationProvider>
  );
}
