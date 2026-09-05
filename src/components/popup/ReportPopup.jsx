import React from 'react'

function ReportPopup() {
    return (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-sm p-4'>
            <div className='bg-[#2a2a2a] text-white rounded-2xl shadow-2xl w-full max-w-xl border border-gray-700 max-h-[90vh] overflow-y-auto'>
                <div className='sticky top-0 bg-[#2a2a2a] border-b border-gray-700 px-6 py-4 flex justify-between items-center'>
                    <h2 className='text-xl font-bold'>Daily Report to System Owner</h2>
                    <button
                        onClick={() => setIsReportModal(false)}
                        className='text-gray-400 hover:text-white transition-colors'
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className='p-6 space-y-5'>


                    {/* Date */}
                    <div>
                        <label className='block text-sm font-medium mb-2 text-gray-300'>
                            Date
                        </label>
                        <input
                            type='text'
                            value={formData.date}
                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                            className='w-full bg-[#1f1f1f] border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all'
                        />
                    </div>

                    {/* Purpose */}
                    <div>
                        <label className='block text-sm font-medium mb-2 text-gray-300'>
                            Purpose
                        </label>
                        <select
                            value={formData.purpose}
                            onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                            className='w-full bg-[#1f1f1f] border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all'
                        >
                            <option>Daily Performance Report</option>
                            <option>Weekly Summary Report</option>
                            <option>Issue Report</option>
                            <option>Progress Update</option>
                        </select>
                    </div>

                    {/* Details */}
                    <div>
                        <label className='block text-sm font-medium mb-2 text-gray-300'>
                            Details
                        </label>
                        <textarea
                            value={formData.details}
                            onChange={(e) => setFormData({ ...formData, details: e.target.value })}
                            placeholder='Enter report details...

Example:
- Team Performance: 15/20 members met quota (75%)
- Morning Shift: 87% quota achievement (+5% from last week)
- Night Shift: 73% quota achievement (-3% from last week)
- Notable Issues: 2 attendance violations recorded
- Action Items: Follow-up meetings scheduled with underperforming members'
                            className='w-full bg-[#1f1f1f] border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all min-h-[200px] resize-none'
                        />
                    </div>

                    {/* File Upload */}
                    <div>
                        <label className='block text-sm font-medium mb-2 text-gray-300'>
                            Attach Performance Data (Optional)
                        </label>
                        <div className='relative'>
                            <input
                                type='file'
                                onChange={handleFileChange}
                                className='w-full bg-[#1f1f1f] border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:bg-sky-600 file:text-white file:cursor-pointer hover:file:bg-sky-600'
                            />
                        </div>
                        {formData.file && (
                            <p className='text-sm text-gray-400 mt-2 flex items-center gap-2'>
                                <Paperclip size={14} />
                                {formData.file}
                            </p>
                        )}
                    </div>

                    {/* Buttons */}
                    <div className='flex gap-3 pt-4'>
                        <button
                            type='button'
                            onClick={() => setIsReportModal(false)}
                            className='flex-1 bg-gray-700 hover:bg-gray-600 px-4 py-2.5 rounded-lg font-medium transition-all'
                        >
                            Cancel
                        </button>
                        <button
                            type='button'
                            onClick={handleSubmit}
                            className='flex-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 px-4 py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2'
                        >
                            <Send size={18} />
                            Send
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default ReportPopup