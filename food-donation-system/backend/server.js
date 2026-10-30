const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");

const app = express();

// ============================
// Middleware
// ============================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use("/uploads", express.static(uploadDir));

// ============================
// MongoDB Connection
// ============================
mongoose.connect("mongodb://127.0.0.1:27017/fooddonet")
.then(async () => {
    console.log("✅ MongoDB Connected to fooddonet database");
    try {
        const adminEmail = "deepaksingh36700@gmail.com";
        const existingAdmin = await User.findOne({ email: adminEmail });
        if (!existingAdmin) {
            await User.create({
                name: "Administrator",
                email: adminEmail,
                mobile: "",
                role: "Admin",
                password: "admin"
            });
            console.log("✅ Default administrator account created");
        }
    } catch (error) {
        console.error("❌ Default administrator setup failed:", error);
    }
})
.catch((err) => console.log("❌ MongoDB Connection Error:", err));

// ============================
// OpenAI Setup
// ============================
const apiKey = process.env.OPENAI_API_KEY || "YOUR_OPENAI_API_KEY_HERE"; 
let openai = null;

if (apiKey && apiKey !== "YOUR_OPENAI_API_KEY_HERE") {
    openai = new OpenAI({ apiKey: apiKey });
    console.log("✅ OpenAI Initialized");
} else {
    console.log("⚠️ No OpenAI API Key found. AI Search will use smart local simulation.");
}

// Helper: Get embedding
async function getEmbedding(text) {
    if (!openai) return []; 
    try {
        const response = await openai.embeddings.create({ model: "text-embedding-3-small", input: text });
        return response.data[0].embedding;
    } catch (err) {
        console.error("Embedding Generation Error:", err.message);
        return [];
    }
}

// ============================
// Schemas
// ============================
const userSchema = new mongoose.Schema({
    name: String, email: String, mobile: String, address: String, 
    pincode: String, role: String, password: String, photo: String,
    embedding: { type: [Number] } // NEW: Vector Embedding for Users
});
const User = mongoose.model("users", userSchema);

const donationSchema = new mongoose.Schema({
    foodName: { type: String, required: true, trim: true },
    desc: { type: String, required: true, trim: true },
    qty: { type: String, required: true, trim: true }, // kg, specs, numbers
    expiry: { type: Date },
    location: { type: String, required: true, trim: true },
    status: { type: String, enum: ['Reviewing', 'Available', 'Reserved', 'Delivered'], default: 'Reviewing' },
    acceptedById: { type: String },
    acceptedByName: { type: String, trim: true },
    icon: { type: String, default: '🍲' },
    donorId: { type: String, required: true },
    donorName: { type: String, required: true, trim: true },
    date: { type: Date, default: Date.now },
    photo: { type: String, trim: true },
    embedding: { type: [Number] } // Vector Embeddings for Food
});
const Donation = mongoose.model("donations", donationSchema);

const notificationSchema = new mongoose.Schema({
    title: { type: String, required: true },
    desc: { type: String, required: true },
    icon: { type: String, default: "🔔" },
    readBy: { type: [String], default: [] },
    date: { type: Date, default: Date.now }
});
const Notification = mongoose.model("notifications", notificationSchema);

const requestSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    quantity: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    organizationId: { type: String, required: true },
    organizationName: { type: String, required: true, trim: true },
    status: { type: String, enum: ["Open", "Fulfilled"], default: "Open" },
    fulfilledById: { type: String },
    fulfilledByName: { type: String, trim: true },
    donationId: { type: String },
    donationFoodName: { type: String, trim: true },
    date: { type: Date, default: Date.now }
});
const CommunityRequest = mongoose.model("communityrequests", requestSchema);

// ============================
// Multer Setup
// ============================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage });

// ============================
// USER APIs (Now with Embeddings)
// ============================
app.post("/register", upload.single("photo"), async (req, res) => {
    try {
        const { name, email, mobile, address, pincode, role, password } = req.body;
        const photo = req.file ? req.file.filename : "";

        const existingUser = await User.findOne({ $or: [{ email }, { mobile }] });
        if (existingUser) return res.status(400).json({ message: "User already exists" });

        // Generate Vector Embedding for User
        const semanticText = `User Profile: Name: ${name}. Email: ${email}. Mobile: ${mobile}. Role: ${role}.`;
        const embedding = await getEmbedding(semanticText);

        const newUser = new User({ name, email, mobile, address, pincode, role, password, photo, embedding: embedding.length ? embedding : undefined });
        await newUser.save();

        res.json({ message: "Registration Successful", user: newUser });
    } catch (error) { res.status(500).json({ message: "Registration Failed", error: error.message }); }
});

app.put("/users/:id", async (req, res) => {
    try {
        const { name, email, mobile, role } = req.body;
        
        // Update Vector Embedding when user is edited
        const semanticText = `User Profile: Name: ${name}. Email: ${email}. Mobile: ${mobile}. Role: ${role}.`;
        const embedding = await getEmbedding(semanticText);

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { $set: { name, email, mobile, role, embedding: embedding.length ? embedding : undefined } },
            { returnDocument: 'after' }
        );
        res.json({ message: "User updated successfully", user });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/login", async (req, res) => {
    try {
        const user = await User.findOne({ $or: [{ email: req.body.identifier }, { mobile: req.body.identifier }] });
        if (!user) return res.status(404).json({ message: "User not found" });
        if (user.password !== req.body.password) return res.status(401).json({ message: "Incorrect password" });
        res.json({ message: "Login successful", user });
    } catch (error) { res.status(500).json({ message: "Login failed", error: error.message }); }
});

app.get("/users", async (req, res) => {
    try { res.json(await User.find()); } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get("/users/:id", async (req, res) => {
    try { res.json(await User.findById(req.params.id)); } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get("/notifications/:userId", async (req, res) => {
    try {
        const notifications = await Notification.find().sort({ date: -1 }).limit(50);
        res.json(notifications.map(notification => ({
            ...notification.toObject(),
            unread: !notification.readBy.includes(req.params.userId)
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put("/notifications/:userId/read", async (req, res) => {
    try {
        await Notification.updateMany(
            { readBy: { $ne: req.params.userId } },
            { $addToSet: { readBy: req.params.userId } }
        );
        res.json({ message: "Notifications marked as read" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/requests", async (req, res) => {
    try {
        res.json(await CommunityRequest.find().sort({ date: -1 }));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/requests", async (req, res) => {
    try {
        const { title, description, quantity, location, userId } = req.body;
        if (![title, description, quantity, location, userId].every(value => typeof value === "string" && value.trim())) {
            return res.status(400).json({ message: "Title, description, quantity, location, and user ID are required" });
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "Invalid user ID" });
        }
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });
        const role = String(user.role || "").trim().toLowerCase();
        if (!["ngo", "ngo partner", "organization", "admin"].includes(role)) {
            return res.status(403).json({ message: "Only organizations and NGOs can post requests" });
        }

        const communityRequest = await CommunityRequest.create({
            title: title.trim(),
            description: description.trim(),
            quantity: quantity.trim(),
            location: location.trim(),
            organizationId: user._id.toString(),
            organizationName: user.name
        });
        await Notification.create({
            title: `New community request: ${communityRequest.title}`,
            desc: `${user.name} needs ${communityRequest.quantity} at ${communityRequest.location}.`,
            icon: "📝"
        });
        res.status(201).json({ message: "Request posted", request: communityRequest });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put("/requests/:id/fulfill", async (req, res) => {
    try {
        const { userId, donationId } = req.body;
        if (!userId || !donationId) {
            return res.status(400).json({ message: "User ID and donation ID are required" });
        }
        if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(donationId)) {
            return res.status(400).json({ message: "Invalid request, user, or donation ID" });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        const communityRequest = await CommunityRequest.findOneAndUpdate(
            { _id: req.params.id, status: "Open" },
            { $set: { status: "Fulfilled", fulfilledById: user._id.toString(), fulfilledByName: user.name, donationId } },
            { returnDocument: "after" }
        );
        if (!communityRequest) {
            const existingRequest = await CommunityRequest.findById(req.params.id);
            if (!existingRequest) return res.status(404).json({ message: "Request not found" });
            return res.status(409).json({ message: "This request has already been fulfilled" });
        }

        const donation = await Donation.findOneAndUpdate(
            { _id: donationId, status: "Available", donorId: user._id.toString() },
            { $set: { status: "Reserved", acceptedById: user._id.toString(), acceptedByName: user.name } },
            { returnDocument: "after" }
        );
        if (!donation) {
            await CommunityRequest.updateOne(
                { _id: communityRequest._id, status: "Fulfilled", fulfilledById: user._id.toString() },
                { $set: { status: "Open" }, $unset: { fulfilledById: 1, fulfilledByName: 1, donationId: 1 } }
            );
            return res.status(409).json({ message: "Choose one of your available donations to fulfill this request" });
        }

        communityRequest.donationFoodName = donation.foodName;
        await communityRequest.save();
        await Notification.create({
            title: `${communityRequest.title} was fulfilled`,
            desc: `${user.name} pledged ${donation.foodName} for ${communityRequest.organizationName}.`,
            icon: "🤝"
        });
        res.json({ message: "Request fulfilled", request: communityRequest });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete("/users/:id", async (req, res) => {
    try { await User.findByIdAndDelete(req.params.id); res.json({ message: "User deleted" }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================
// DONATION APIs (Now tracking Qty/Status in Embeddings)
// ============================
app.get("/donations", async (req, res) => {
    try { res.json(await Donation.find().sort({date: -1})); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/donations/:id", async (req, res) => {
    try { res.json(await Donation.findById(req.params.id)); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/donations", upload.any(), async (req, res) => {
    try {
        const { foodName, foodDesc, foodQty, foodExpiry, foodLocation, donorId, donorName } = req.body;
        let uploadedPhoto = req.files && req.files.length > 0 ? req.files[0].filename : undefined;

        // Expanded Semantic Text including specs, kg, and status
        const semanticText = `Food Donation: ${foodName}. Description: ${foodDesc}. Quantity and Specs: ${foodQty}. Status: Available. Location: ${foodLocation}.`;
        const embedding = await getEmbedding(semanticText);

        const donation = new Donation({
            foodName, desc: foodDesc, qty: foodQty, expiry: foodExpiry || undefined, location: foodLocation,
            donorId, donorName, photo: uploadedPhoto, status: "Available",
            embedding: embedding.length ? embedding : undefined
        });

        await donation.save();
        await Notification.create({
            title: `Food donation available: ${foodName}`,
            desc: `Donated by ${donorName}. Quantity: ${foodQty}.`,
            icon: "🍲"
        });
        res.status(201).json({ message: "Donation created", donation });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/donations/:id/accept", async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ message: "User ID is required" });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        const donation = await Donation.findOneAndUpdate(
            { _id: req.params.id, status: "Available", donorId: { $ne: user._id.toString() } },
            { $set: { status: "Reserved", acceptedById: user._id.toString(), acceptedByName: user.name } },
            { returnDocument: "after" }
        );
        if (!donation) {
            const existingDonation = await Donation.findById(req.params.id);
            if (!existingDonation) return res.status(404).json({ message: "Donation not found" });
            if (existingDonation.donorId === user._id.toString()) {
                return res.status(403).json({ message: "You cannot accept your own donation" });
            }
            return res.status(409).json({ message: "This donation is no longer available" });
        }

        await Notification.create({
            title: `${donation.foodName} was accepted`,
            desc: `Accepted by ${user.name}.`,
            icon: "✅"
        });
        res.json({ message: "Donation accepted", donation });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put("/donations/:id", async (req, res) => {
    try {
        const updates = req.body;
        
        // Re-calculate embedding on update so Status/Qty changes are searchable
        const semanticText = `Food Donation: ${updates.foodName}. Description: ${updates.desc}. Quantity and Specs: ${updates.qty}. Status: ${updates.status || 'Reviewing'}. Location: ${updates.location}.`;
        const embedding = await getEmbedding(semanticText);

        const donation = await Donation.findByIdAndUpdate(
            req.params.id,
            { $set: { ...updates, embedding: embedding.length ? embedding : undefined } },
            { returnDocument: 'after' }
        );
        res.json({ message: "Updated", donation });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/donations/:id", async (req, res) => {
    try { await Donation.findByIdAndDelete(req.params.id); res.json({ message: "Deleted" }); } catch (err) { res.status(500).json({ error: err.message }); }
});


// ============================
// ✨ OMNI RAG SEARCH (Searches Users AND Donations)
// ============================
app.post("/api/rag-search", async (req, res) => {
    try {
        const { query, userId } = req.body;
        if (typeof query !== "string" || !query.trim()) {
            return res.status(400).json({ error: "Enter a search question." });
        }
        if (query.length > 300) return res.status(400).json({ error: "Search question is too long." });

        const normalizedQuery = query.trim().toLowerCase();
        const words = normalizedQuery.match(/[\p{L}\p{N}]+/gu) || [];
        const ignoredWords = new Set(["a", "an", "all", "and", "are", "available", "delivered", "do", "donation", "donations", "for", "find", "food", "foods", "give", "how", "i", "in", "list", "me", "my", "of", "please", "search", "show", "the", "to", "what", "where", "which", "who", "with", "reviewing", "pending", "reserved", "accepted", "user", "users", "standard", "admin", "admins", "administrator", "administrators", "donor", "donors", "donater", "donaters", "community", "contributor", "contributors", "ngo", "ngos", "partner", "partners", "organization", "organizations"]);
        const searchWords = words.filter(word => !ignoredWords.has(word));
        const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const tokenRegexes = searchWords.map(word => new RegExp(escapeRegex(word), "i"));
        const statusByWord = {
            available: "Available",
            reviewing: "Reviewing",
            pending: "Reviewing",
            reserved: "Reserved",
            accepted: "Reserved",
            delivered: "Delivered"
        };
        const requestedStatus = words.map(word => statusByWord[word]).find(Boolean);
        const roleCategories = {
            donor: ["donater", "donor", "community contributor"],
            donors: ["donater", "donor", "community contributor"],
            donater: ["donater", "donor", "community contributor"],
            donaters: ["donater", "donor", "community contributor"],
            community: ["donater", "donor", "community contributor"],
            contributor: ["donater", "donor", "community contributor"],
            contributors: ["donater", "donor", "community contributor"],
            ngo: ["ngo", "ngo partner"],
            ngos: ["ngo", "ngo partner"],
            partner: ["ngo", "ngo partner"],
            partners: ["ngo", "ngo partner"],
            organization: ["organization"],
            organizations: ["organization"],
            user: ["user", "standard user"],
            users: ["user", "standard user"],
            standard: ["user", "standard user"],
            admin: ["admin"],
            admins: ["admin", "administrator"],
            administrator: ["admin", "administrator"],
            administrators: ["admin", "administrator"]
        };
        const requestedRoles = [...new Set(words.flatMap(word => roleCategories[word] || []))];
        const isUserQuery = words.some(word => ["user", "users", "standard", "admin", "admins", "administrator", "administrators", "donor", "donors", "donater", "donaters", "community", "contributor", "contributors", "ngo", "ngos", "partner", "partners", "organization", "organizations"].includes(word));
        const isFoodQuery = words.some(word => ["food", "foods", "donation", "donations", "available", "reviewing", "pending", "reserved", "accepted", "delivered", "rice", "meal", "meals"].includes(word));
        const isDonationHelpQuery = /\b(how|help|steps)\b.*\b(donate|donation|donations)\b|\b(donate|donation|donations)\b.*\b(how|help|steps)\b/.test(normalizedQuery);
        const isGreeting = /^(hi|hello|hey)\b/.test(normalizedQuery);

        let topDonations = [];
        let topUsers = [];
        if (!isUserQuery || isFoodQuery) {
            const donationFilter = {};
            if (requestedStatus) donationFilter.status = requestedStatus;
            if (tokenRegexes.length) {
                donationFilter.$or = [
                    ...tokenRegexes.flatMap(regex => [
                        { foodName: regex },
                        { desc: regex },
                        { qty: regex },
                        { location: regex }
                    ])
                ];
            }
            topDonations = await Donation.find(donationFilter).sort({ date: -1 }).limit(10);
        }

        if (isUserQuery && userId && mongoose.Types.ObjectId.isValid(userId)) {
            const requester = await User.findById(userId).select("role");
            if (requester && String(requester.role).toLowerCase() === "admin") {
                const userFilter = {};
                if (requestedRoles.length) {
                    userFilter.role = { $in: requestedRoles.map(role => new RegExp(`^${escapeRegex(role)}$`, "i")) };
                }
                if (tokenRegexes.length) {
                    userFilter.$or = tokenRegexes.flatMap(regex => [
                        { name: regex },
                        { email: regex },
                        { mobile: regex },
                        { role: regex }
                    ]);
                }
                topUsers = await User.find(userFilter).select("-password -embedding").limit(10);
            }
        }

        let answer;
        if (isDonationHelpQuery) {
            answer = "To donate food, open Donations, choose New Donation, enter the food details and pickup location, then select Save Donation. Other users will be notified.";
        } else if (isGreeting) {
            answer = "Hi! I can help find available food, donations by name or location, and (for administrators) users by role or name.";
        } else if (topDonations.length || topUsers.length) {
            const summaries = [];
            if (topDonations.length) {
                summaries.push(`I found ${topDonations.length} food donation${topDonations.length === 1 ? "" : "s"}: ${topDonations.map(donation => `${donation.foodName} (${donation.qty}, ${donation.status})`).join("; ")}.`);
            }
            if (topUsers.length) {
                summaries.push(`I found ${topUsers.length} user${topUsers.length === 1 ? "" : "s"}: ${topUsers.map(user => `${user.name} (${user.role})`).join("; ")}.`);
            }
            answer = summaries.join(" ");
        } else if (isUserQuery && (!userId || !mongoose.Types.ObjectId.isValid(userId))) {
            answer = "Please sign in again to search user accounts.";
        } else if (isUserQuery && userId) {
            const requester = await User.findById(userId).select("role");
            if (!requester || String(requester.role).toLowerCase() !== "admin") {
                answer = "User directory searches are available to administrators. You can search food donations by name, quantity, location, or status.";
            } else {
                answer = "No matching users or donations found. Try a name, email, role, food name, or status.";
            }
        } else {
            answer = "I couldn't find matching records. Try a food name, quantity, location, status, or a user role.";
        }

        res.json({ answer, donationResults: topDonations, userResults: topUsers });
    } catch (err) {
        console.error("Database search failed:", err);
        res.status(500).json({ error: "Search failed while reading platform data." });
    }
});

app.use((req, res) => {
    res.status(404).json({ message: `API route not found: ${req.method} ${req.path}` });
});

// Start Server
app.listen(5000, () => {
    console.log(`🚀 Server running on http://localhost:5000`);
});