// backend/models/Donation.js

const mongoose = require("mongoose");

const donationSchema = new mongoose.Schema({

  foodName: {
    type: String,
    required: true,
    trim: true
  },

  foodDesc: {
    type: String,
    required: true,
    trim: true
  },

  foodQty: {
    type: String,
    required: true,
    trim: true
  },

  foodExpiry: {
    type: Date
  },

  foodLocation: {
    type: String,
    required: true,
    trim: true
  },

  status: {
    type: String,
    enum: ["Reviewing", "Available", "Reserved", "Delivered"],
    default: "Reviewing"
  },

  acceptedById: {
    type: String
  },

  acceptedByName: {
    type: String,
    trim: true
  },

  icon: {
    type: String,
    default: "🍲"
  },

  donorId: {
    type: String,
    required: true
  },

  donorName: {
    type: String,
    required: true,
    trim: true
  },

  photo: {
    type: String,
    trim: true
  },

  date: {
    type: Date,
    default: Date.now
  }

});

module.exports = mongoose.model("Donation", donationSchema);