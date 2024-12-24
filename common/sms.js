/**
 * Created by Indrani on 12-12-2015.
 */
var req = require('request');

module.exports =

{
    send_sms: function (phone,message)
    {
        console.log("came to notify " + phone + message);

        if ((phone.length > 12) && (phone.length < 10)) {
            return;
        }
        if (phone.length == 12) {
            if (phone.substring(0, 2) == '91') {
                phone = phone.substring(2);
            }
            else {
                return;
            }
        }
		
		var enc_message = encodeURI(message);
		var url = "https://control.msg91.com/api/sendhttp.php?authkey=143035A4mPPSzZfN25989def5&mobiles="
			+ phone + "&message="+ enc_message + "&sender=RDALRT&route=4&country=91";
		console.log("msg91 url1 formed"); // + url);

		req(url, {timeout: 1500}, function (error, response, body) 
		{
				
				if(error)
				{
					console.log("msg91 timeout1 error code " + error.code + " err connect " + error.connect);
					if(error.code === 'ETIMEDOUT')
					{

						var url = "https://control.msg91.com/api/v4/SendSMS?authkey=143035A4mPPSzZfN25989def5&mobiles="
							   + phone + "&message="+ enc_message + "&sender=RDALRT&route=4&country=91";
					   console.log("msg91 url2 formed " + url); // + url);

						req(url, {timeout: 1500}, function (error, response, body)
						{

							if(error)
							{
								console.log("msg91 timeout2 error code " + error.code + " err connect " + error.connect);
								if(error.code === 'ETIMEDOUT')
								{

									var url1 = "http://sms6.routesms.com:8080/bulksms/bulksms?username=roadm&password=rdmrd34&type=0&dlr=0&destination="
										+ phone + "&source=RDMTCS&message=" + enc_message;
									console.log("routesms formed after msg91 timedout ");
									req(url1, function (error, response, body) {
										if(error){
											console.log("routesms timeout error code " + error.code + " err connect " + error.connect);
											console.log("routesms sms error| " + reply[1] + "| " + message + "| " + error);
											return;
										}
										if (!error && response.statusCode == 200)
										{
											console.log("sms sent  Route",message);
										}
									});
								}

								//return;
							}
							if (!error) {

								console.log("msg91 sent SMS ",body,message);
							}


						});

					}
					
					//return;
				}
				if (!error) {

					console.log("msg91 sent SMS ",body,message);
				}
				

		});

		
		
        /*url = "http://sms6.routesms.com:8080/bulksms/bulksms?username=roadm&password=rdmrd34&type=0&dlr=0&destination="
        + phone + "&source=RDMTCS&message=" + message;

        req(url, function (error, response, body) {
            console.log("before err check sms body " + body);
            if (!error && response.statusCode == 200) {
                console.log("sms body " + body); // Print the google web page.
            }
        });*/
    }
}