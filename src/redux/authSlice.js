import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { toast } from "react-hot-toast";
import axiosInstance from "../Helpers/axiosInstance";
import * as backendAuth from "../Helpers/backendAuthClient";
import { setActiveOrganizationId } from "../Helpers/backendSession";

// VITE_BACKEND_AUTH_MODE=true routes login/logout/current-user through the
// real cookie-session backend (backendAuthClient.js) instead of the mock
// Bearer-JWT flow. Every other thunk here still goes through axiosInstance.
const { BACKEND_AUTH_MODE_ENABLED } = backendAuth;

async function backendLogin({ username, password, otp }) {
  let user;
  try {
    ({ user } = await backendAuth.loginWithIdentifier(username, password, otp));
  } catch (err) {
    // Two-factor accounts: the password was right, now ask for the code
    // (the Login page resubmits the same credentials with it).
    if (err?.response?.data?.code === "MFA_REQUIRED") return { user: {}, require2FA: true };
    throw err;
  }
  const { organizations } = await backendAuth.listOrganizations();
  setActiveOrganizationId(organizations?.[0]?._id || null);
  return { user, require2FA: false };
}

const initialState = {
  isLoggedIn: localStorage.getItem("isLoggedIn") || false,
  data: (() => {
    try {
      const storedData = localStorage.getItem("data");
      return storedData ? JSON.parse(storedData) : {};
    } catch (error) {
      return {};
    }
  })(),
  role: localStorage.getItem("role") || "",
  users: [],
  tempToken: null,
  require2FA: false,
  fcmToken: localStorage.getItem("fcmToken") || null,
  error: null,
  loading: false,
};

// function to handle signup
export const createAccount = createAsyncThunk("/auth/signup", async (data) => {
  try {
    let res = axiosInstance.post("user/register", data);

    toast.promise(res, {
      loading: "Wait! Creating your account",
      success: (data) => {
        return data?.data?.message;
      },
      error: "Failed to create account",
    });

    // getting response resolved here
    res = await res;
    return res.data;
  } catch (error) {
    toast.error(error?.response?.data?.message);
  }
});
export const addAdminAccount = createAsyncThunk(
  "/auth/signup",
  async (data) => {
    try {
      const res = axiosInstance.post("user/add-admin", data, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      toast.promise(res, {
        loading: "Wait! Adding User account...",
        success: (data) => {
          return data?.data?.message;
        },
        error: "failed to create a account",
      });
      // console.log(res)
      return (await res).data;
    } catch (error) {
      toast.error(error?.response?.data?.message);
    }
  }
);
// function to handle login
export const login = createAsyncThunk(
  "auth/login",
  async (data, { rejectWithValue }) => {
    try {
      if (BACKEND_AUTH_MODE_ENABLED) return await backendLogin(data);
      const res = await axiosInstance.post("/user/login", data);
      return res.data;
    } catch (err) {
      console.log(err.response?.data?.message); // for debugging
      return rejectWithValue(err.response?.data?.message || "Login failed");
    }
  }
);


export const addFcm = createAsyncThunk(
  "/auth/add-fcm",
  async (fcmToken, { rejectWithValue }) => {
    try {

      const res = axiosInstance.post("/user/updateFCM", { fcmToken });


      const response = await res;
      return response.data;
    } catch (error) {
      const errorMessage =
        error?.response?.data?.message || "Failed to update FCM token";
      return rejectWithValue(errorMessage);
    }
  }
);
export const editUserAccount = createAsyncThunk(
  "/user/editAccount",
  async ({ id, userData }, { rejectWithValue }) => {
    try {
      const res = axiosInstance.put(`/user/edit/${id}`, userData);

      toast.promise(res, {
        loading: "Updating user account...",
        success: (data) => data?.data?.message || "User updated successfully!",
        error: (err) => err?.response?.data?.message || "Failed to update user",
      });

      const response = await res;
      return response.data;

    } catch (error) {
      const errorMessage = error?.response?.data?.message || "Failed to update user account";
      toast.error(errorMessage);
      return rejectWithValue(errorMessage);
    }
  }
);
// Add this with other async thunks
export const updateUserStatus = createAsyncThunk(
  'user/updateStatus',
  async ({ id, status }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put(`/user/${id}/status`, { status });

      toast.success(response.data.message || `User ${status} successfully!`);

      return response.data;
    } catch (error) {
      toast.error(
        error?.response?.data?.message || `Failed to update user status!`
      );
      return rejectWithValue(error?.response?.data || "Failed to update status");
    }
  }
);

// Aur yeh backend route bhi add karna hoga controllers mein
export const verify2FA = createAsyncThunk(
  "/auth/verify-2fa",
  async ({ otp }, { rejectWithValue }) => {
    try {
      // No need to handle token here - let the interceptor do its job
      const response = await axiosInstance.post(
        "user/verify-2fa",
        { otp },
        {
          withCredentials: true
        }
      );

      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.message ||
        error.message ||
        "2FA verification failed";

      console.error("2FA verification failed:", {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });

      toast.error(errorMessage);
      return rejectWithValue(errorMessage);
    }
  }
);
// function to handle logout
export const logout = createAsyncThunk("auth/logout", async () => {
  try {
    if (BACKEND_AUTH_MODE_ENABLED) return await backendAuth.logout();
    let res = axiosInstance.post("/user/logout");
    res = await res;
    return res.data;
  } catch (error) {
    toast.error(error.message);
  }
});
export const deleteUser = createAsyncThunk("user/deleteUser", async (userId, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.delete(`/user/delete/${userId}`);
    return response.data;
  } catch (error) {
    return rejectWithValue(error.response.data.message || "Failed to delete user");
  }
});

// function to fetch user data
export const getUserData = createAsyncThunk("/user/details", async (_, { rejectWithValue }) => {
  try {
    if (BACKEND_AUTH_MODE_ENABLED) return await backendAuth.getCurrentUser();
    const res = await axiosInstance.get("/user/me");
    return res?.data;
  } catch (error) {
    // Swallowing this into a "successful" undefined payload used to let
    // getUserData.fulfilled run with action.payload.user === undefined,
    // which wrote the literal string "undefined" into localStorage.data
    // and reset state.role to undefined — exactly what RequireAuth checks,
    // silently kicking the user to /denied on any transient failure here.
    toast.error(error.message);
    return rejectWithValue(error.message);
  }
});
export const getAllUsers = createAsyncThunk(
  "/user/getAllUsers",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get("/user/all");
      return response.data.users;

    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch users"
      );
    }
  }
);
export const getDepartmentUsers = createAsyncThunk(
  "/user/getDepartmentUsers",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get("/user/departmentwise");
      return response.data.users;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch department users"
      );
    }
  }
);

// function to change user password
export const changePassword = createAsyncThunk(
  "/auth/changePassword",
  async (userPassword) => {
    try {
      let res = axiosInstance.post("/user/change-password", userPassword);

      await toast.promise(res, {
        loading: "Loading...",
        success: (data) => {
          return data?.data?.message;
        },
        error: "Failed to change password",
      });

      // getting response resolved here
      res = await res;
      return res.data;
    } catch (error) {
      toast.error(error?.response?.data?.message);
    }
  }
);

// function to handle forget password
export const forgetPassword = createAsyncThunk(
  "auth/forgetPassword",
  async (email) => {
    try {
      let res = axiosInstance.post("/user/reset", { email });

      await toast.promise(res, {
        loading: "Loading...",
        success: (data) => {
          return data?.data?.message;
        },
        error: "Failed to send verification email",
      });

      // getting response resolved here
      res = await res;
      return res.data;
    } catch (error) {
      toast.error(error?.response?.data?.message);
    }
  }
);

// function to update user profile
export const updateProfile = createAsyncThunk(
  "/user/update/profile",
  async (data) => {
    try {
      const formData = data[1];
      const config = {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      };

      let res = axiosInstance.put(`/user/update/${data[0]}`, formData, config);

      toast.promise(res, {
        loading: "Updating...",
        success: (data) => {
          return data?.data?.message;
        },
        error: "Failed to update profile",
      });

      res = await res;
      return res.data;
    } catch (error) {
      toast.error(error?.response?.data?.message || "Upload failed");
    }
  }
);


// function to reset the password
export const resetPassword = createAsyncThunk("/user/reset", async (data) => {
  try {
    let res = axiosInstance.post(`/user/reset/${data.resetToken}`, {
      password: data.password,
    });

    toast.promise(res, {
      loading: "Resetting...",
      success: (data) => {
        return data?.data?.message;
      },
      error: "Failed to reset password",
    });
    // getting response resolved here
    res = await res;
    return res.data;
  } catch (error) {
    toast.error(error?.response?.data?.message);
  }
});

export const updateUserRole = createAsyncThunk(
  'user/updateRole',
  async ({ id, role }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put(`/user/${id}/role`, { role });

      toast.success(response.data.message || "Role updated successfully!");

      return response.data;
    } catch (error) {
      toast.error(
        error?.response?.data?.message || "Failed to update user role!"
      );
      return rejectWithValue(error?.response?.data || "Failed to update role");
    }
  }
);

export const updateUserShift = createAsyncThunk(
  "/user/updateShift",
  async ({ id, Shift, startFrom }, { rejectWithValue }) => {
    try {
      const res = axiosInstance.put(`/user/update-shift/${id}`, {
        Shift,
        startFrom,
      });

      toast.promise(res, {
        loading: "Updating shift...",
        success: (data) => data?.data?.message || "Shift updated!",
        error: (err) => err?.response?.data?.message || "Failed to update shift",
      });

      const response = await res;
      return response.data;

    } catch (error) {
      return rejectWithValue(
        error?.response?.data?.message || "Shift update failed"
      );
    }
  }
);

export const requestAccountDeletion = createAsyncThunk(
  'auth/requestAccountDeletion',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post('/users/request-deletion');
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to request account deletion'
      );
    }
  }
);
export const deleteAccount = createAsyncThunk(
  'auth/deleteAccount',
  async ({ password, confirmationToken }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.delete('/users/delete-account', {
        data: { password, confirmationToken }
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message || 'Failed to delete account'
      );
    }
  }
);
const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(login.fulfilled, (state, action) => {
        if (!action.payload) return;

        const { user, token, require2FA } = action.payload;


        if (token) {
          state.tempToken = token;
          localStorage.setItem('tempAuthToken', token);
        }
        state.data = user;
        state.require2FA = require2FA;

        if (!require2FA) {
          state.isLoggedIn = true;
          state.token = token;
          state.role = user.role;

          // Backend-auth mode has no token — the session lives in httpOnly
          // cookies — so never write the string "undefined" here.
          if (token) localStorage.setItem('token', token);
          localStorage.setItem('data', JSON.stringify(user));
          localStorage.setItem('isLoggedIn', 'true');
          localStorage.setItem('role', user.role);
        }
      })
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
        console.log(state.error, "errors")
      })
      .addCase(verify2FA.fulfilled, (state, action) => {
        if (action.payload?.success) {
          // Store the new token
          const { token, user } = action.payload;

          // Clear temporary token
          state.tempToken = null;
          localStorage.removeItem('tempAuthToken');

          // Set permanent token and user data
          state.token = token;
          state.data = user;
          state.role = user.role;
          state.isLoggedIn = true;
          state.require2FA = false;

          // Persist to storage
          localStorage.setItem('token', token);
          localStorage.setItem('data', JSON.stringify(user));
          localStorage.setItem('isLoggedIn', 'true');
          localStorage.setItem('role', user.role);
        }
      })
      .addCase(verify2FA.rejected, (state, action) => {
        // Keep 2FA required state
        state.require2FA = true;
        state.error = action.payload;
        // Don't clear tempToken so the user can try again
      })
      .addCase(editUserAccount.fulfilled, (state, action) => {
        if (action.payload?.success) {
          const updatedUser = action.payload.user;

          // Update user in the users array
          state.users = state.users.map((user) =>
            user._id === updatedUser._id ? updatedUser : user
          );

          // If the edited user is the current logged-in user, update their data too
          if (state.data._id === updatedUser._id) {
            state.data = updatedUser;
            state.role = updatedUser.role;
            localStorage.setItem('data', JSON.stringify(updatedUser));
            localStorage.setItem('role', updatedUser.role);
          }
        }
      })
      .addCase(editUserAccount.rejected, (state, action) => {
        toast.error(action.payload || "Failed to update user!");
      })
      // for user logout
      .addCase(logout.fulfilled, (state) => {
        localStorage.clear();
        state.isLoggedIn = false;
        state.data = {};
      })
      // for user details
      .addCase(getUserData.fulfilled, (state, action) => {
        if (!action?.payload?.user) return; // defensive: never overwrite a real session with an empty one
        localStorage.setItem("data", JSON.stringify(action.payload.user));
        localStorage.setItem("isLoggedIn", true);
        state.isLoggedIn = true;
        state.data = action?.payload?.user;
        state.role = action?.payload?.user?.role;
      })
      .addCase(updateUserRole.fulfilled, (state, action) => {
        state.status = 'succeeded',
          state.auth = action.payload;
      })
      .addCase(getDepartmentUsers.fulfilled, (state, action) => {
        state.loading = false;
        state.users = action.payload;
      })

      .addCase(getAllUsers.fulfilled, (state, action) => {
        state.loading = false;
        state.users = action.payload;
      })
      .addCase(addAdminAccount.fulfilled, (state, action) => {
        if (action.payload?.success && state.users) {
          state.users.push(action.payload.newUser);
        }
      })
      .addCase(addFcm.fulfilled, (state, action) => {
        if (action.payload?.success) {
          state.fcmToken = action.payload?.user?.fcmToken;
          localStorage.setItem("fcmToken", action.payload?.user?.fcmToken);
        }
      })
      .addCase(updateUserShift.fulfilled, (state, action) => {
        const updatedUser = action.payload.user;

        // Replace the user in state.users immediately
        state.users = state.users.map((u) =>
          u._id === updatedUser._id ? updatedUser : u
        );
      })
      .addCase(updateUserShift.rejected, (state, action) => {
        toast.error(action.payload || "Shift update failed!");
      })
      .addCase(requestAccountDeletion.pending, (state) => {
        state.loading = true;
        state.isError = false;
        state.isSuccess = false;
      })
      .addCase(requestAccountDeletion.fulfilled, (state, action) => {
        state.loading = false;
        state.isSuccess = true;
        state.deleteRequested = true;
        state.message = action.payload.message;
        // Store token in development only
        if (action.payload.data?.token) {
          state.deleteToken = action.payload.data.token;
        }
      })
      .addCase(requestAccountDeletion.rejected, (state, action) => {
        state.loading = false;
        state.isError = true;
        state.message = action.payload || 'Something went wrong';
      })

      // Delete Account
      .addCase(deleteAccount.pending, (state) => {
        state.loading = true;
        state.isError = false;
        state.isSuccess = false;
      })
      .addCase(deleteAccount.fulfilled, (state, action) => {
        state.loading = false;
        state.isSuccess = true;
        state.user = null;
        state.deleteRequested = false;
        state.deleteToken = null;
        state.message = action.payload.message;

        // Clear local storage
        localStorage.removeItem('user');
        localStorage.removeItem('token');
      })
      .addCase(deleteAccount.rejected, (state, action) => {
        state.isLoading = false;
        state.isError = true;
        state.message = action.payload || 'Failed to delete account';
      });

  },
});

export default authSlice.reducer;
