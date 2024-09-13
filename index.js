const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { format } = require('date-fns');
const router = require('./Routes/route');
const dotEnv = require('dotenv');
const app = express();
dotEnv.config();

app.use(cors());
app.use(bodyParser.json());

const port = process.env.PORT || 8080;

let initialEnergyValues = Array(70).fill(null);
let firstStoredEnergyValues = Array(70).fill(null);
let isFirstDataStoredToday = false;

const config = {
  host: process.env.host,
  user: process.env.user,
  password: process.env.password,
  database: process.env.database,
};

// Routes are coming from Routes folder route.js
app.use('/api', router);

async function initializeInitialEnergyValues() {
  try {
    console.log("Initializing initial energy values...");
    const connection = await mysql.createConnection(config);

    const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
    const today = format(new Date(), 'yyyy-MM-dd');
    
    const previousDayQuery = `
      SELECT ${Array.from({ length: 70 }, (_, i) => `TotalNet_KWH_meter_${i + 1}`).join(", ")} 
      FROM sensordata 
      WHERE DATE(timestamp) = ? 
      ORDER BY timestamp DESC 
      LIMIT 1
    `;
    
    const todayFirstRecordQuery = `
      SELECT ${Array.from({ length: 70 }, (_, i) => `TotalNet_KWH_meter_${i + 1}`).join(", ")} 
      FROM sensordata 
      WHERE DATE(timestamp) = ? 
      ORDER BY timestamp ASC 
      LIMIT 1
    `;

    const [previousDayRows] = await connection.execute(previousDayQuery, [yesterday]);
    if (previousDayRows.length > 0) {
      for (let i = 0; i < 70; i++) {
        initialEnergyValues[i] = previousDayRows[0][`TotalNet_KWH_meter_${i + 1}`];
      }
      console.log("Initial energy values stored from the previous day:", initialEnergyValues);
    } else {
      console.log("No data found for the previous day. Fetching today's first record.");
      const [todayRows] = await connection.execute(todayFirstRecordQuery, [today]);
      if (todayRows.length > 0) {
        for (let i = 0; i < 70; i++) {
          initialEnergyValues[i] = todayRows[0][`TotalNet_KWH_meter_${i + 1}`];
        }
        console.log("Initial energy values set to today's first record:", initialEnergyValues);
      } else {
        console.log("No data found for today yet.");
      }
    }

    await connection.end();
  } catch (error) {
    console.error("Error initializing initial energy values:", error);
  }
}

async function fetchDataAndStore() {
  try {
    console.log("Fetching and storing sensor data...");
    const response = await axios.get(`${process.env.API_URL}`);
    const newData = response.data[0];

    const energyConsumptions = Array(70).fill(null);
    for (let i = 0; i < 70; i++) {
      if (initialEnergyValues[i] === null) {
        initialEnergyValues[i] = newData[`TotalNet_KWH_meter_${i + 1}`];
        console.log(`Setting initial energy value for meter ${i + 1} to the current value:`, initialEnergyValues[i]);
      }
      energyConsumptions[i] = newData[`TotalNet_KWH_meter_${i + 1}`] - initialEnergyValues[i];
    }

    // Generate IST timestamp
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST offset in milliseconds
    const istTimestamp = new Date(now.getTime() + istOffset).toISOString().slice(0, 19).replace('T', ' ');

    const query = `
      INSERT INTO sensordata (
        timestamp, 
        ${Array.from({ length: 70 }, (_, i) => `Total_KW_meter_${i + 1}, Total_KVA_meter_${i + 1}, Avg_PF_meter_${i + 1}, TotalNet_KWH_meter_${i + 1}, TotalNet_KVAH_meter_${i + 1}, energy_consumption_m${i + 1}`).join(", ")}
      ) 
      VALUES (
        ?, 
        ${Array.from({ length: 70 }, () => "?").join(", ")},
        ${Array.from({ length: 70 }, () => "?").join(", ")},
        ${Array.from({ length: 70 }, () => "?").join(", ")},
        ${Array.from({ length: 70 }, () => "?").join(", ")},
        ${Array.from({ length: 70 }, () => "?").join(", ")}
      )
    `;
    
    const values = Array.from({ length: 70 }, (_, i) => [
      newData[`Total_KW_meter_${i + 1}`],
      newData[`Total_KVA_meter_${i + 1}`],
      newData[`Avg_PF_meter_${i + 1}`],
      newData[`TotalNet_KWH_meter_${i + 1}`],
      newData[`TotalNet_KVAH_meter_${i + 1}`],
      energyConsumptions[i]
    ]).flat();

    console.log("Executing query:", query);
    console.log("With values:", [istTimestamp, ...values]);

    const connection = await mysql.createConnection(config);
    const [result] = await connection.query(query, [istTimestamp, ...values]);
    await connection.end();

    console.log("Sensor data stored successfully:", newData);
    console.log("Database insert result:", result);

    if (!isFirstDataStoredToday) {
      firstStoredEnergyValues = initialEnergyValues.slice();
      isFirstDataStoredToday = true;
      console.log("First stored energy values for today:", firstStoredEnergyValues);
    }

    const currentDate = format(new Date(), 'yyyy-MM-dd');
    const fileName = `VITB_${currentDate}.txt`;
    const filePath = path.join(__dirname, "VIT-Data", fileName);

    appendDataToFile(newData, filePath);
  } catch (error) {
    console.error("Error fetching and storing sensor data:", error);
  }

  // Call the function recursively with a delay (e.g., every 20 minutes)
  // setTimeout(fetchDataAndStore, 20 * 60000);
}

function formatSensorData(data) {
  const dateTime = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
  const formattedData = `${dateTime},${Array.from({ length: 70 }, (_, i) => data[`TotalNet_KWH_meter_${i + 1}`]).join(",")}\n`;
  return formattedData;
}

function appendDataToFile(data, filePath) {
  const formattedData = formatSensorData(data);

  fs.appendFile(filePath, formattedData, { flag: 'a+' }, (err) => {
    if (err) {
      console.error("Error appending data to file:", err);
    } else {
      console.log("Data appended to file successfully.");
    }
  });
}

initializeInitialEnergyValues().then(() => {
  // Schedule fetchDataAndStore to run every 20 minutes
  setInterval(fetchDataAndStore, 60000);
  // Schedule initializeInitialEnergyValues to run every 24 hours
  setInterval(initializeInitialEnergyValues, 60000);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
