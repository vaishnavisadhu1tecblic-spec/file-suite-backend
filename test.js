// const { MongoClient } = require("mongodb");

// const uri =
//   "mongodb+srv://kml1311:Kml123@cluster0.c152wpp.mongodb.net/?appName=Cluster0";

// async function main() {
//   const client = new MongoClient(uri);

//   try {
//     await client.connect();
//     await client.db("admin").command({ ping: 1 });
//     console.log("MongoDB connection successful!");
//   } catch (error) {
//     console.error("MongoDB connection failed:", error);
//   } finally {
//     await client.close();
//   }
// }

// main();

const dns = require("dns");

dns.resolveSrv(
  "_mongodb._tcp.cluster0.c152wpp.mongodb.net",
  (err, addresses) => {
    if (err) {
      console.error(err);
    } else {
      console.log(addresses);
    }
  },
);
